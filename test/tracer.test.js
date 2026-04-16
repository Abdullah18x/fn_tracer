'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createTracer, getContext } = require('..');

// ── Silent logger — suppresses console output during tests ────────────────────
const silent = {
  info:  () => {},
  error: () => {},
  warn:  () => {},
  debug: () => {},
};

// Use an isolated tracer with the silent logger for all tests.
// getContext() is still the global export — it reads from the shared ALS instance.
const { withTrace, traceAll } = createTracer({ logger: silent });

// ── withTrace ─────────────────────────────────────────────────────────────────

describe('withTrace', () => {

  it('creates a root context when no trace is active', async () => {
    let ctx;
    await withTrace('myFn', () => { ctx = getContext(); });

    assert.ok(ctx,                                          'context should exist');
    assert.ok(typeof ctx.traceId === 'string',              'traceId should be a string');
    assert.ok(ctx.traceId.length > 0,                      'traceId should not be empty');
    assert.strictEqual(ctx.depth,               0,          'depth should be 0 for root');
    assert.strictEqual(ctx.currentFunctionName, 'myFn',    'currentFunctionName should match');
    assert.strictEqual(ctx.rootFunctionName,    'myFn',    'rootFunctionName should match');
    assert.strictEqual(ctx.parentFunctionName,  null,       'parentFunctionName should be null at root');
    assert.deepStrictEqual(ctx.path,            ['myFn'],  'path should contain only root fn');
    assert.ok(ctx.spanId === ctx.rootSpanId,               'root spanId should equal rootSpanId');
  });

  it('creates a child context that inherits traceId', async () => {
    let rootCtx, childCtx, grandChildCtx;

    await withTrace('root', async () => {
      rootCtx = getContext();

      await withTrace('child', async () => {
        childCtx = getContext();

        await withTrace('grandchild', () => {
          grandChildCtx = getContext();
        });
      });
    });

    // child inherits traceId
    assert.strictEqual(childCtx.traceId,           rootCtx.traceId,  'child should share traceId');
    assert.strictEqual(childCtx.depth,             1,                 'child depth should be 1');
    assert.strictEqual(childCtx.parentFunctionName,'root',           'child parent should be root');
    assert.deepStrictEqual(childCtx.path,          ['root', 'child'],'child path should extend');

    // grandchild inherits same traceId, depth increments again
    assert.strictEqual(grandChildCtx.traceId,      rootCtx.traceId,  'grandchild should share traceId');
    assert.strictEqual(grandChildCtx.depth,        2,                 'grandchild depth should be 2');
    assert.strictEqual(grandChildCtx.parentFunctionName, 'child',    'grandchild parent should be child');
    assert.deepStrictEqual(grandChildCtx.path, ['root','child','grandchild'], 'grandchild path correct');

    // each span has a unique spanId
    const ids = [rootCtx.spanId, childCtx.spanId, grandChildCtx.spanId];
    assert.strictEqual(new Set(ids).size, 3, 'all spanIds should be unique');
  });

  it('concurrent top-level calls get different traceIds and do not cross-contaminate', async () => {
    const results = [];

    await Promise.all([
      withTrace('flowA', async () => {
        await new Promise(r => setTimeout(r, 10));
        results.push({ name: 'A', traceId: getContext().traceId });
      }),
      withTrace('flowB', async () => {
        await new Promise(r => setTimeout(r, 10));
        results.push({ name: 'B', traceId: getContext().traceId });
      }),
    ]);

    assert.strictEqual(results.length, 2);
    assert.notStrictEqual(results[0].traceId, results[1].traceId, 'concurrent flows must have different traceIds');
  });

  it('context propagates through setTimeout', async () => {
    let ctxInTimeout;

    await withTrace('timerFn', () => new Promise(resolve => {
      setTimeout(() => {
        ctxInTimeout = getContext();
        resolve();
      }, 5);
    }));

    assert.ok(ctxInTimeout,                                               'context should exist in setTimeout');
    assert.strictEqual(ctxInTimeout.currentFunctionName, 'timerFn', 'should be the same span');
  });

  it('returns the wrapped function return value', async () => {
    const result = await withTrace('add', () => 2 + 2);
    assert.strictEqual(result, 4);
  });

  it('works with sync functions', async () => {
    let ctx;
    const result = await withTrace('syncFn', () => {
      ctx = getContext();
      return 'hello';
    });
    assert.strictEqual(result, 'hello');
    assert.ok(ctx);
    assert.strictEqual(ctx.depth, 0);
  });

  it('rethrows errors without swallowing them', async () => {
    const boom = new Error('intentional error');
    await assert.rejects(
      () => withTrace('failing', () => { throw boom; }),
      (err) => err === boom  // must be the exact same error instance
    );
  });

  it('context is gone outside trace after completion', async () => {
    await withTrace('tempFn', () => {});
    // After completion, context reverts to whatever it was before (undefined at top level)
    assert.strictEqual(getContext(), undefined);
  });

  // ── Input validation ────────────────────────────────────────────────────────

  it('throws TypeError for non-string functionName', () => {
    assert.throws(() => withTrace(123,   () => {}), TypeError);
    assert.throws(() => withTrace(null,  () => {}), TypeError);
    assert.throws(() => withTrace({},    () => {}), TypeError);
  });

  it('throws TypeError for empty functionName', () => {
    assert.throws(() => withTrace('',    () => {}), TypeError);
    assert.throws(() => withTrace('   ', () => {}), TypeError);
  });

  it('throws TypeError for non-function fn', () => {
    assert.throws(() => withTrace('test', 'notafunction'), TypeError);
    assert.throws(() => withTrace('test', null),           TypeError);
    assert.throws(() => withTrace('test', 42),             TypeError);
  });

});

// ── traceAll ──────────────────────────────────────────────────────────────────

describe('traceAll', () => {

  it('wraps all functions and assigns correct function names', async () => {
    const ctxs = {};
    const wrapped = traceAll({
      foo: () => { ctxs.foo = getContext(); },
      bar: () => { ctxs.bar = getContext(); },
    });

    await wrapped.foo();
    await wrapped.bar();

    assert.ok(ctxs.foo, 'foo should have context');
    assert.ok(ctxs.bar, 'bar should have context');
    assert.strictEqual(ctxs.foo.currentFunctionName, 'foo');
    assert.strictEqual(ctxs.bar.currentFunctionName, 'bar');
  });

  it('passes arguments through to the wrapped function', async () => {
    const wrapped = traceAll({
      add: (a, b) => a + b,
    });
    const result = await wrapped.add(3, 4);
    assert.strictEqual(result, 7);
  });

  it('propagates errors from wrapped functions', async () => {
    const err = new Error('traceAll error');
    const wrapped = traceAll({ boom: () => { throw err; } });
    await assert.rejects(() => wrapped.boom(), (e) => e === err);
  });

  it('inner call inherits outer traceId when called through wrapped object', async () => {
    let outerCtx, innerCtx;

    const svc = traceAll({
      outer: async () => {
        outerCtx = getContext();
        await svc.inner();  // must go through svc, not bare inner()
      },
      inner: () => {
        innerCtx = getContext();
      },
    });

    await svc.outer();

    assert.ok(outerCtx && innerCtx);
    assert.strictEqual(innerCtx.traceId, outerCtx.traceId, 'inner should share traceId with outer');
    assert.strictEqual(innerCtx.depth,   1,                 'inner should be depth 1');
  });

  // ── Input validation ────────────────────────────────────────────────────────

  it('throws TypeError for null or non-object input', () => {
    assert.throws(() => traceAll(null),     TypeError);
    assert.throws(() => traceAll('string'), TypeError);
    assert.throws(() => traceAll(42),       TypeError);
    assert.throws(() => traceAll([]),       TypeError);
  });

  it('throws TypeError for empty object', () => {
    assert.throws(() => traceAll({}), TypeError);
  });

  it('throws TypeError if any value is not a function', () => {
    assert.throws(() => traceAll({ foo: () => {}, bar: 'notafn' }), TypeError);
    assert.throws(() => traceAll({ foo: 123 }),                      TypeError);
  });

});

// ── getContext ────────────────────────────────────────────────────────────────

describe('getContext', () => {

  it('returns undefined when called outside any trace', () => {
    assert.strictEqual(getContext(), undefined);
  });

  it('returns the current context when inside a trace', async () => {
    await withTrace('check', () => {
      const ctx = getContext();
      assert.ok(ctx);
      assert.strictEqual(ctx.currentFunctionName, 'check');
    });
  });

});

// ── createTracer ──────────────────────────────────────────────────────────────

describe('createTracer', () => {

  it('returns withTrace, traceAll, getContext, and logger', () => {
    const tracer = createTracer({ logger: silent });
    assert.strictEqual(typeof tracer.withTrace,  'function');
    assert.strictEqual(typeof tracer.traceAll,   'function');
    assert.strictEqual(typeof tracer.getContext, 'function');
    assert.ok(tracer.logger);
  });

  it('throws TypeError for non-object opts', () => {
    assert.throws(() => createTracer('bad'), TypeError);
    assert.throws(() => createTracer(42),    TypeError);
  });

  it('tracers from different createTracer calls share the global ALS context', async () => {
    const tracerA = createTracer({ logger: silent });
    const tracerB = createTracer({ logger: silent });
    let ctxFromB;

    await tracerA.withTrace('fromA', async () => {
      // Even though tracerB has its own logger, the ALS is shared
      await tracerB.withTrace('fromB', () => {
        ctxFromB = getContext();
      });
    });

    assert.ok(ctxFromB);
    // fromB should be a child of fromA's context (same traceId)
    assert.strictEqual(ctxFromB.depth,             1);
    assert.strictEqual(ctxFromB.parentFunctionName, 'fromA');
  });

});
