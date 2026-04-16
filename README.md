# fn-tracer

Function-level async tracing for Node.js using **AsyncLocalStorage**. Zero boilerplate — wrap your module exports once with `traceAll()` and every function gets automatic span tracking, context propagation across `await`/`setTimeout`/`Promise`, and structured logging.

## Install

```bash
npm install fn-tracer
```

Winston is an optional peer dependency. If installed, it's used for rich, colourful log output. Without it, the built-in logger falls back to a simple console transport.

```bash
npm install winston   # optional, recommended
```

## Quick start

```js
const { traceAll, logger } = require('fn-tracer');

const svc = traceAll({
  async processOrder(orderId) {
    logger.info(`Processing order ${orderId}`);
    await svc.validateOrder(orderId);
  },
  async validateOrder(orderId) {
    logger.debug(`Validating ${orderId}`);
  },
});

await svc.processOrder('ORD-1');
```

Every call gets its own `spanId`. Calls that share a top-level entry get the same `traceId`. Concurrent top-level calls never bleed into each other.

```
16:40:40.218  INFO  [0e46383b][9c01f6b9]  →  processOrder              (processOrder)
16:40:40.218  INFO  [0e46383b][fe53b936]  →    validateOrder            (processOrder › validateOrder)
16:40:40.220  INFO  [0e46383b][fe53b936]  ←    validateOrder  2ms
16:40:40.220  INFO  [0e46383b][9c01f6b9]  ←  processOrder  3ms
```

## API

### `traceAll(fns)` — wrap a module at the export boundary

```js
const svc = traceAll({ processOrder, validateOrder, loadCustomer });
module.exports = svc;
```

Pass an object of plain functions. Every function in the returned object is automatically wrapped in a span. **Inner calls must go through the returned object** (`svc.validateOrder()`), not the bare function name, to receive their own span.

### `withTrace(functionName, fn)` — wrap a single function

```js
const result = await withTrace('processOrder', async () => {
  return doWork();
});
```

### `getContext()` — read the current span

```js
const { traceId, spanId, depth, path } = getContext() ?? {};
// Use traceId to correlate logs or pass it to outbound HTTP calls
res.setHeader('X-Trace-Id', traceId);
```

Returns `undefined` when called outside any traced execution.

### `createTracer(opts)` — custom logger configuration

```js
const { createTracer } = require('fn-tracer');

// JSON output for production log aggregators
const tracer = createTracer({ logFormat: 'json', logLevel: 'info' });

// Silent logger for tests
const tracer = createTracer({ logger: { info: () => {}, error: () => {} } });

// Bring your own Winston instance
const tracer = createTracer({ logger: myWinstonLogger });

const { withTrace, traceAll, getContext, logger } = tracer;
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logger` | object | — | Custom logger (must have `.info()` and `.error()`). When provided, other options are ignored. |
| `logLevel` | string | `'debug'` | Winston log level |
| `logFormat` | `'pretty'` \| `'json'` | `'pretty'` | Output format |
| `transports` | array | Console | Override Winston transports |

### `createLogger(opts)` — standalone logger

Creates a Winston logger that reads trace context at emit time (always accurate for the current span).

```js
const { createLogger } = require('fn-tracer');
const log = createLogger({ format: 'json', level: 'info' });
```

## Trace context shape

```ts
interface TraceContext {
  traceId: string;             // shared across the entire root execution tree
  spanId: string;              // unique per function invocation
  rootSpanId: string;          // spanId of the top-level function
  rootFunctionName: string;    // name of the top-level function
  currentFunctionName: string; // name of the current function
  parentFunctionName: string | null;
  depth: number;               // 0 for root, increments per nesting level
  startTime: number;           // Unix timestamp (ms)
  path: string[];              // ordered call path from root to current
}
```

## Common patterns

**Express / Fastify handler**
```js
const handlers = traceAll({
  async getOrder(req, res) {
    const order = await orderService.findById(req.params.id);
    res.json(order);
  }
});
app.get('/orders/:id', handlers.getOrder);
```

**Queue consumer (BullMQ, SQS, RabbitMQ)**
```js
const consumers = traceAll({
  async processMessage(job) {
    await handleJob(job);
  }
});
queue.process(consumers.processMessage);
```

**Cron job**
```js
const jobs = traceAll({
  async dailyReport() {
    await buildReport();
    await sendReport();
  }
});
cron.schedule('0 9 * * *', jobs.dailyReport);
```

## How it works

`AsyncLocalStorage` (from `node:async_hooks`) binds a store to an async execution tree. When `withTrace()` calls `asyncLocalStorage.run(newContext, fn)`, the context propagates automatically through all `await`, `Promise`, and `setTimeout` calls inside `fn` — no manual plumbing required.

For child spans, the new context inherits the parent's `traceId` but gets a fresh `spanId` and incremented `depth`. For root spans (no active context), a new `traceId` is generated via `crypto.randomUUID()`.

The logger calls `getContext()` inside its `printf` formatter — at log-emit time, not logger-creation time — so it always reads the correct span regardless of concurrency.

## Requirements

- Node.js >= 18.0.0

## License

MIT
