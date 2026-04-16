# fn-tracer

Function-level async tracing for Node.js using **AsyncLocalStorage**. Zero boilerplate — wrap your module exports once with `traceAll()` and every function gets automatic span tracking, context propagation across `await`/`setTimeout`/`Promise`, and structured logging.

## Features

- 🔍 **Per-function span tracking** — automatic enter/exit/error/duration logs per function
- 🧵 **Automatic context propagation** — `traceId` flows through `await`, `Promise`, `setTimeout` with no manual passing
- 🌐 **HTTP middleware** — drop-in Express and Fastify middleware for per-request tracing
- 📝 **Custom log levels** — built-in support for `notice` and any custom level
- 🎨 **Custom badges** — override level badge labels and colors in pretty output
- 🔧 **Bring your own logger** — plug in any existing Winston instance
- 📦 **JSON output** — structured logs for Datadog, Loki, CloudWatch
- 🛡️ **Production safe** — all formatting errors are caught and never crash your app
- 🟦 **Full TypeScript support** — complete type definitions included, no `@types` package needed
- ⚡ **Node.js >= 18** — built on the stable `AsyncLocalStorage` API

---

## Install

```bash
npm install fn-tracer
```

Winston is an optional peer dependency used for rich, colourful log output:

```bash
npm install winston   # optional, recommended
```

---

## Quick start

```js
const { traceAll, logger } = require('fn-tracer');

let svc;
svc = module.exports = traceAll({
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
16:40:40.218   INFO  [0e46383b][9c01f6b9]  →  processOrder              (processOrder)
16:40:40.218   INFO  [0e46383b][fe53b936]  →    validateOrder            (processOrder › validateOrder)
16:40:40.220   INFO  [0e46383b][fe53b936]  ←    validateOrder  2ms
16:40:40.220   INFO  [0e46383b][9c01f6b9]  ←  processOrder  3ms
```

---

## HTTP Middleware

### Express / NestJS / Connect

Drop in a single line before your routes — every request gets a root trace span automatically:

```js
const express = require('express');
const { expressMiddleware, logger } = require('fn-tracer');

const app = express();

app.use(expressMiddleware({ logger, logRequests: true }));

// Optional: custom span name per route
app.use(expressMiddleware({
  logger,
  requestName: (req) => `${req.method} ${req.route?.path || req.path}`,
}));
```

### Fastify

```js
const { fastifyPlugin, logger } = require('fn-tracer');

await fastify.register(fastifyPlugin, { logger, logRequests: true });
```

### Middleware options

| Option | Type | Default | Description |
|---|---|---|---|
| `requestName` | `string \| (req) => string` | `"METHOD /path"` | Root span name for the request |
| `logRequests` | `boolean` | `true` | Log request enter/exit with duration and HTTP status |
| `logger` | object | fn-tracer default | Logger instance to use for request logs |

### What the middleware logs

```
18:49:08.001   INFO  [abc12345][def67890]  → POST /api/orders
18:49:08.005   INFO  [abc12345][aaa11111]    → processOrder         (POST /api/orders › processOrder)
18:49:08.020   NOTE  [abc12345][aaa11111]       Item stock insufficient
18:49:08.021   INFO  [abc12345][aaa11111]    ← processOrder  16ms
18:49:08.022   INFO  [abc12345][def67890]  ← POST /api/orders  21ms  httpStatus=400
```

---

## API

### `traceAll(fns)` — wrap a module at the export boundary

```js
const svc = traceAll({ processOrder, validateOrder, loadCustomer });
module.exports = svc;
```

Pass an object of plain functions. Every function in the returned object is automatically wrapped in a span. **Inner calls must go through the returned object** (e.g. `svc.validateOrder()`), not the original function reference, to receive their own span.

### `withTrace(functionName, fn)` — wrap a single function

```js
const result = await withTrace('processPayment', async () => {
  return doWork();
});
```

### `getContext()` — read the current span

```js
const { traceId, spanId, depth, path } = getContext() ?? {};

// Forward traceId to downstream services
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

// Bring your own existing Winston instance
const tracer = createTracer({ logger: myWinstonLogger });

// Custom level badges
const tracer = createTracer({
  logFormat: 'pretty',
  badges: {
    notice: { label: ' NOTE ', color: 'magenta' },
    warn:   { label: ' WARN ', color: 'yellow'  },
  }
});

const { withTrace, traceAll, getContext, logger } = tracer;
```

| Option | Type | Default | Description |
|---|---|---|---|
| `logger` | object | — | Custom logger (must have `.info()` and `.error()`). When provided, all other options are ignored. |
| `logLevel` | string | `'debug'` | Minimum log level |
| `logFormat` | `'pretty'` \| `'json'` | `'pretty'` | Output format |
| `transports` | array | Console | Override Winston transports |
| `badges` | object | — | Custom level badge definitions (see below) |

### `createLogger(opts)` — standalone logger

Creates a Winston logger that reads trace context at emit time:

```js
const { createLogger } = require('fn-tracer');
const log = createLogger({ format: 'json', level: 'info' });
```

---

## Custom log levels and badges

The built-in logger supports `error`, `warn`, `notice`, `info`, `http`, `verbose`, `debug`, `silly`.

You can customise the badge shown in pretty output for any level:

```js
const { createTracer } = require('fn-tracer');

const { logger } = createTracer({
  badges: {
    // Plain string — auto-styled in bold white, padded to 7 chars
    silly: ' SILLY ',

    // Label + color key (available: red, green, yellow, blue, magenta, cyan, white, gray)
    notice: { label: ' NOTE ', color: 'magenta' },

    // Pre-styled ANSI string for full control
    warn: '\x1b[1m\x1b[33m ALERT \x1b[0m',
  }
});

logger.notice('User not found');  // → shown with magenta NOTE badge
```

---

## Custom logs with trace context

Use the `logger` exported by `fn-tracer` for your own log messages. It automatically attaches `traceId`, `spanId`, `depth`, and the call path to every log call:

```js
const { traceAll, logger } = require('fn-tracer');

const svc = traceAll({
  async processOrder(req, res) {
    logger.info('Processing order');          // ✅ traceId auto-attached
    logger.notice('Item stock insufficient'); // ✅ traceId auto-attached
    logger.error('Payment failed');           // ✅ traceId auto-attached
  }
});
```

### Using your own existing logger

If you already have a logger in your app, pass it to `createTracer` and use `getContext()` to enrich your own log calls:

```js
const { createTracer, getContext } = require('fn-tracer');

const { traceAll } = createTracer({ logger: myExistingLogger });

// Enrich your own logger manually
const ctx = getContext();
myExistingLogger.info('message', { traceId: ctx?.traceId, spanId: ctx?.spanId });
```

---

## Trace context shape

```ts
interface TraceContext {
  traceId: string;               // shared across the entire root execution tree
  spanId: string;                // unique per function invocation
  rootSpanId: string;            // spanId of the top-level function
  rootFunctionName: string;      // name of the top-level function
  currentFunctionName: string;   // name of the current function
  parentFunctionName: string | null;
  depth: number;                 // 0 for root, increments per nesting level
  startTime: number;             // Unix timestamp (ms)
  path: string[];                // ordered call path from root to current
}
```

---

## Multi-file tracing

When functions are spread across files, wrap each file's exports with `traceAll`. The package automatically builds parent-child relationships across file boundaries:

```js
// inventoryService.js
const { traceAll } = require('fn-tracer');
const _checkStock = async (itemId) => { /* ... */ };
module.exports = traceAll({ checkStock: _checkStock });

// orderController.js
const { traceAll, logger } = require('fn-tracer');
const inventoryService = require('./inventoryService'); // already traced

let self;
const _processOrder = async (req, res) => {
  const inStock = await inventoryService.checkStock(req.body.itemId); // ← becomes child span
  logger.notice('Item stock insufficient');
};
self = module.exports = traceAll({ processOrder: _processOrder });
```

Logs:
```
→ processOrder          depth=0  traceId=abc
  → checkStock          depth=1  traceId=abc  parentFunctionName=processOrder
  ← checkStock  4ms
← processOrder  9ms
```

---

## Concurrent requests — no context bleed

Two requests calling the same function simultaneously are fully isolated. Each async chain carries its own context:

```
[traceId=abc]  processOrder  → checkStock   ← called by request A
[traceId=xyz]  processOrder  → checkStock   ← called by request B (same function, different context)
```

Group logs by `traceId` to reconstruct any individual request's full call chain.

---

## Common patterns

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

**Silent logger for tests**
```js
const { createTracer } = require('fn-tracer');
const { traceAll } = createTracer({ logger: { info: () => {}, error: () => {} } });
```

---

## TypeScript

No `@types` package needed — type definitions are bundled:

```ts
import { createTracer, traceAll, getContext, expressMiddleware } from 'fn-tracer';
import type { TraceContext, CreateTracerOptions, MiddlewareOptions } from 'fn-tracer';

const { logger } = createTracer({ logFormat: 'json' });

const ctx: TraceContext | undefined = getContext();
```

---

## How it works

`AsyncLocalStorage` (from `node:async_hooks`) binds a store to an async execution tree. When `withTrace()` calls `asyncLocalStorage.run(newContext, fn)`, the context propagates automatically through all `await`, `Promise`, and `setTimeout` calls inside `fn` — no manual plumbing required.

For child spans, the new context inherits the parent's `traceId` but gets a fresh `spanId` and incremented `depth`. For root spans (no active context), a new `traceId` is generated via `crypto.randomUUID()`.

The logger calls `getContext()` inside its `printf` formatter — at log-emit time, not logger-creation time — so it always reads the correct span regardless of concurrency.

---

## Requirements

- Node.js >= 18.0.0

## License

MIT
