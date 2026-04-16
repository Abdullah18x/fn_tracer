'use strict';

const storage = require('./storage');
const { buildRootContext, buildChildContext } = require('./context');

/**
 * Returns the currently active trace context, or undefined if no trace is running.
 *
 * Safe to call from anywhere — returns undefined outside a trace rather than throwing.
 *
 * @returns {import('../types').TraceContext | undefined}
 */
function getContext() {
  return storage.getStore();
}

/**
 * Creates a bound pair of withTrace / traceAll that log via the provided logger.
 *
 * Separating the logger from the core ALS logic means:
 *  - The core tracing is testable with a silent/mock logger
 *  - Users can inject their own Winston instance (or any logger with info/error methods)
 *  - The global storage singleton is still shared, so context propagates across the whole app
 *
 * @param {{ info: Function, error: Function }} logger
 * @returns {{ withTrace: Function, traceAll: Function }}
 */
function createTracerCore(logger) {
  if (!logger || typeof logger.info !== 'function' || typeof logger.error !== 'function') {
    throw new TypeError(
      'createTracerCore: logger must be an object with at least info() and error() methods'
    );
  }

  /**
   * Wraps a function (sync or async) in a trace span.
   *
   * - No active context → becomes ROOT of a new trace (new traceId)
   * - Active context exists → becomes CHILD span (inherits traceId, depth+1)
   *
   * @param {string} functionName - Label for this span
   * @param {Function} fn - The function to execute
   * @returns {Promise<any>}
   */
  function withTrace(functionName, fn) {
    // ── Input validation ────────────────────────────────────────────────────
    if (typeof functionName !== 'string' || !functionName.trim()) {
      throw new TypeError(
        `withTrace: functionName must be a non-empty string, got ${JSON.stringify(functionName)}`
      );
    }
    if (typeof fn !== 'function') {
      throw new TypeError(
        `withTrace: fn must be a function, got ${typeof fn}`
      );
    }

    const parent = getContext();
    const context = parent
      ? buildChildContext(parent, functionName)
      : buildRootContext(functionName);

    // storage.run() binds `context` to the entire async resource tree started here.
    // await, Promise chains, and setTimeout inside the callback all inherit it automatically.
    return storage.run(context, async () => {
      // Safe log — if the logger itself throws we don't want to swallow the user's error
      try { logger.info(functionName, { status: 'enter' }); } catch (_) {}

      try {
        const result = await fn();
        const duration = Date.now() - context.startTime;
        try { logger.info(functionName, { status: 'exit', duration }); } catch (_) {}
        return result;
      } catch (err) {
        const duration = Date.now() - context.startTime;
        try {
          logger.error(functionName, {
            status: 'error',
            duration,
            errorMessage: err.message,
            errorStack: err.stack,
          });
        } catch (_) {}
        throw err; // always rethrow — we never swallow user errors
      }
    });
  }

  /**
   * Wraps every function in a plain object with withTrace at the export boundary.
   * Function bodies stay completely plain — no tracing code needed inside them.
   *
   * IMPORTANT: inner calls between functions in the same module must go through
   * the returned traced object, not the original function references, otherwise
   * those calls won't get their own span.
   *
   * @param {Record<string, Function>} fns
   * @returns {Record<string, Function>}
   */
  function traceAll(fns) {
    // ── Input validation ──────────────────────────────────────────────────
    if (fns === null || typeof fns !== 'object' || Array.isArray(fns)) {
      throw new TypeError(
        `traceAll: expected a plain object of functions, got ${Array.isArray(fns) ? 'Array' : typeof fns}`
      );
    }

    const entries = Object.entries(fns);
    if (entries.length === 0) {
      throw new TypeError('traceAll: fns object must contain at least one function');
    }

    const traced = {};
    for (const [name, fn] of entries) {
      if (typeof fn !== 'function') {
        throw new TypeError(
          `traceAll: expected all values to be functions, but "${name}" is ${typeof fn}`
        );
      }
      traced[name] = (...args) => withTrace(name, () => fn(...args));
    }
    return traced;
  }

  return { withTrace, traceAll };
}

module.exports = { getContext, createTracerCore };
