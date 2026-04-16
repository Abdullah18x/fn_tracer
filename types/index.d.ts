/**
 * fn-tracer — TypeScript definitions
 */

// ── Trace context ─────────────────────────────────────────────────────────────

export interface TraceContext {
  /** Shared across the entire root execution tree */
  traceId: string;
  /** Unique per function invocation */
  spanId: string;
  /** spanId of the root (top-level) function */
  rootSpanId: string;
  /** Name of the top-level function that started this trace */
  rootFunctionName: string;
  /** Name of the function this span belongs to */
  currentFunctionName: string;
  /** Name of the calling function, or null if this is the root */
  parentFunctionName: string | null;
  /** Call depth — 0 for root, increments for each level of nesting */
  depth: number;
  /** Unix timestamp (ms) when this span started */
  startTime: number;
  /** Ordered list of function names from root to current */
  path: string[];
}

// ── Core function signatures ──────────────────────────────────────────────────

export type WithTraceFn = (functionName: string, fn: () => any) => Promise<any>;

export type TraceAllFn = <T extends Record<string, (...args: any[]) => any>>(
  fns: T
) => T;

export type GetContextFn = () => TraceContext | undefined;

// ── Logger interface (minimal — compatible with Winston and most loggers) ─────

export interface TraceLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  debug?(message: string, meta?: Record<string, unknown>): void;
  [key: string]: any;
}

// ── createLogger options ──────────────────────────────────────────────────────

export interface CreateLoggerOptions {
  /** Minimum log level. Defaults to 'debug'. */
  level?: 'error' | 'warn' | 'info' | 'debug' | 'verbose' | string;
  /** Output format. Defaults to 'pretty'. */
  format?: 'pretty' | 'json';
  /** Override Winston transports. Defaults to Console. */
  transports?: any[];
}

// ── createTracer options ──────────────────────────────────────────────────────

export interface CreateTracerOptions {
  /**
   * Bring your own logger.
   * Must implement at minimum: info(msg, meta?) and error(msg, meta?).
   * When provided, logLevel / logFormat / transports are ignored.
   */
  logger?: TraceLogger;
  /** Minimum log level for the built-in logger. Defaults to 'debug'. */
  logLevel?: string;
  /** Output format for the built-in logger. Defaults to 'pretty'. */
  logFormat?: 'pretty' | 'json';
  /** Override Winston transports for the built-in logger. */
  transports?: any[];
}

// ── TracerInstance ────────────────────────────────────────────────────────────

export interface TracerInstance {
  withTrace: WithTraceFn;
  traceAll: TraceAllFn;
  getContext: GetContextFn;
  logger: TraceLogger;
}

// ── Module exports ────────────────────────────────────────────────────────────

/**
 * Wraps a single function in a trace span using the default logger.
 *
 * If no trace context is active, this function becomes the ROOT of a new trace.
 * If a context is already active, this becomes a CHILD span inheriting the traceId.
 *
 * @example
 * const result = await withTrace('processOrder', async () => {
 *   return doWork();
 * });
 */
export declare const withTrace: WithTraceFn;

/**
 * Wraps every function in a plain object with a span at the export boundary.
 * Function bodies stay completely plain — no tracing code needed inside them.
 *
 * IMPORTANT: inner calls between functions must go through the returned traced
 * object (not the original references) to receive their own span.
 *
 * @example
 * const svc = traceAll({ processOrder, validateOrder, loadCustomer });
 * module.exports = svc;
 */
export declare const traceAll: TraceAllFn;

/**
 * Returns the currently active trace context, or undefined if called outside
 * any traced execution.
 *
 * Use this to enrich your own logs or pass traceId to outbound HTTP calls.
 *
 * @example
 * const ctx = getContext();
 * if (ctx) {
 *   res.setHeader('X-Trace-Id', ctx.traceId);
 * }
 */
export declare const getContext: GetContextFn;

/**
 * The default Winston logger instance.
 * Reads trace context at log-emit time — always accurate for the current span.
 */
export declare const logger: TraceLogger;

/**
 * Creates an isolated tracer instance with its own logger configuration.
 * The global AsyncLocalStorage is still shared, so context propagates correctly.
 *
 * @example
 * // JSON output for production
 * const tracer = createTracer({ logFormat: 'json', logLevel: 'info' });
 *
 * // Silent logger for tests
 * const tracer = createTracer({ logger: { info: () => {}, error: () => {} } });
 */
export declare function createTracer(opts?: CreateTracerOptions): TracerInstance;

/**
 * Creates a standalone Winston logger that reads trace context at emit time.
 * Useful if you want a configured logger without the full createTracer API.
 */
export declare function createLogger(opts?: CreateLoggerOptions): TraceLogger;
