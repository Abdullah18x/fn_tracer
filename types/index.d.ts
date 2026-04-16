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
  notice?(message: string, meta?: Record<string, unknown>): void;
  debug?(message: string, meta?: Record<string, unknown>): void;
  [key: string]: any;
}

// ── createLogger options ──────────────────────────────────────────────────────

/** A custom badge definition for a log level. */
export type BadgeDefinition =
  | string                              // plain label, e.g. ' NOTE '
  | { label: string; color: string };   // label + ANSI color key, e.g. { label: ' NOTE ', color: 'magenta' }

export interface CreateLoggerOptions {
  /** Minimum log level. Defaults to 'debug'. */
  level?: 'error' | 'warn' | 'info' | 'debug' | 'verbose' | string;
  /** Output format. Defaults to 'pretty'. */
  format?: 'pretty' | 'json';
  /** Override Winston transports. Defaults to Console. */
  transports?: any[];
  /**
   * Custom level badges for pretty output.
   * Keys are log level names, values are either a plain string label
   * or an object with label + color (ANSI color key).
   * @example
   * badges: {
   *   notice: { label: ' NOTE ', color: 'magenta' },
   *   silly:  ' SILLY '
   * }
   */
  badges?: Record<string, BadgeDefinition>;
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
  /**
   * Custom level badges for pretty output.
   * Keys are log level names, values are either a plain string label
   * or an object with label + color (ANSI color key).
   * @example
   * badges: {
   *   notice: { label: ' NOTE ', color: 'magenta' },
   *   silly:  ' SILLY '
   * }
   */
  badges?: Record<string, BadgeDefinition>;
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

// ── Middleware ────────────────────────────────────────────────────────────────

export interface MiddlewareOptions {
  /**
   * Name for the root span. Can be a static string or a function that
   * receives the request and returns a string.
   * Defaults to "METHOD /path" (e.g. "POST /api/login").
   */
  requestName?: string | ((req: any) => string);
  /**
   * Whether to log request enter/exit spans. Defaults to true.
   */
  logRequests?: boolean;
  /**
   * Logger instance to use for request logs.
   * Uses the fn-tracer default logger if not provided.
   */
  logger?: TraceLogger;
}

/**
 * Express/Connect middleware that starts a root trace span for every
 * incoming HTTP request.
 *
 * Every traceAll/withTrace call during the request becomes a child span.
 *
 * @example
 * import express from 'express';
 * import { expressMiddleware, logger } from 'fn-tracer';
 *
 * const app = express();
 * app.use(expressMiddleware({ logger, logRequests: true }));
 */
export declare function expressMiddleware(opts?: MiddlewareOptions): (
  req: any,
  res: any,
  next: () => void
) => void;

/**
 * Fastify plugin that starts a root trace span for every incoming request.
 *
 * @example
 * import Fastify from 'fastify';
 * import { fastifyPlugin, logger } from 'fn-tracer';
 *
 * const fastify = Fastify();
 * await fastify.register(fastifyPlugin, { logger, logRequests: true });
 */
export declare function fastifyPlugin(
  fastify: any,
  opts: MiddlewareOptions,
  done: () => void
): void;
