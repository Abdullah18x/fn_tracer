'use strict';

/**
 * fn-tracer
 *
 * Function-level async tracing for Node.js using AsyncLocalStorage.
 *
 * ── Quick start ──────────────────────────────────────────────────────────────
 *
 *   const { traceAll, getContext, logger } = require('fn-tracer');
 *
 *   const svc = traceAll({
 *     async processOrder(orderId) {
 *       logger.info(`Processing order ${orderId}`);
 *       await svc.validateOrder(orderId);
 *     },
 *     async validateOrder(orderId) {
 *       logger.debug(`Validating ${orderId}`);
 *     },
 *   });
 *
 *   await svc.processOrder('ORD-1');
 *
 * ── Custom logger / options ──────────────────────────────────────────────────
 *
 *   const { createTracer } = require('fn-tracer');
 *
 *   const tracer = createTracer({
 *     logLevel: 'info',
 *     logFormat: 'json',          // 'pretty' (default) | 'json'
 *     logger: myExistingLogger,   // bring your own (must have .info() and .error())
 *   });
 *
 *   const { withTrace, traceAll, logger } = tracer;
 */

const { getContext, createTracerCore } = require('./src/tracer');
const { createLogger }                 = require('./src/logger');

// ── Default instance (module singleton) ──────────────────────────────────────
// Most applications only need this. The logger is created lazily on first use
// so that importing the package does not crash if winston is not installed.

let _defaultLogger  = null;
let _defaultTracer  = null;

function getDefaultTracer() {
  if (!_defaultTracer) {
    _defaultLogger = createLogger();
    _defaultTracer = createTracerCore(_defaultLogger);
  }
  return _defaultTracer;
}

/**
 * Wraps a single function in a trace span using the default logger.
 *
 * @type {import('./types').WithTraceFn}
 */
function withTrace(functionName, fn) {
  return getDefaultTracer().withTrace(functionName, fn);
}

/**
 * Wraps every function in a plain object with a span at the export boundary.
 * Uses the default logger.
 *
 * @type {import('./types').TraceAllFn}
 */
function traceAll(fns) {
  return getDefaultTracer().traceAll(fns);
}

/**
 * Returns the current trace context from AsyncLocalStorage, or undefined if
 * called outside any traced execution.
 *
 * @type {import('./types').GetContextFn}
 */
// getContext is re-exported directly — it never needs a logger

// ── Factory (for custom configuration) ───────────────────────────────────────

/**
 * Creates an isolated tracer instance with its own logger configuration.
 *
 * Use this when you need:
 *  - JSON output instead of coloured pretty logs (production log aggregators)
 *  - A custom log level
 *  - Your own existing Winston logger instance
 *  - A silent logger in tests
 *
 * The underlying AsyncLocalStorage is still the global singleton, so context
 * propagates correctly across the whole application regardless of which
 * tracer instance creates the spans.
 *
 * @param {import('./types').CreateTracerOptions} [opts]
 * @returns {import('./types').TracerInstance}
 */
function createTracer(opts = {}) {
  if (typeof opts !== 'object' || opts === null || Array.isArray(opts)) {
    throw new TypeError('createTracer: opts must be a plain object');
  }

  const log = opts.logger || createLogger({
    level:  opts.logLevel  || 'debug',
    format: opts.logFormat || 'pretty',
    transports: opts.transports,
  });

  const core = createTracerCore(log);

  return {
    withTrace: core.withTrace,
    traceAll:  core.traceAll,
    getContext,
    logger: log,
  };
}

// ── Lazy default logger accessor ─────────────────────────────────────────────
// Exposed so callers can do:  const { logger } = require('fn-tracer')
// and get the same logger instance that withTrace/traceAll use by default.

Object.defineProperty(module.exports, 'logger', {
  get() { return (getDefaultTracer(), _defaultLogger); },
  enumerable: true,
});

module.exports = {
  // Core API
  withTrace,
  traceAll,
  getContext,
  // Factory
  createTracer,
  createLogger,
  // logger is defined via defineProperty above
};
