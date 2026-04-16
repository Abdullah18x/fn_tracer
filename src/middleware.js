'use strict';

const { buildRootContext } = require('./context');
const storage              = require('./storage');

/**
 * Resolves the trace name for a request.
 * Uses requestName option if provided, otherwise falls back to "METHOD /path".
 *
 * @param {object} req
 * @param {Function|string|undefined} requestName
 * @returns {string}
 */
function resolveTraceName(req, requestName) {
  try {
    if (typeof requestName === 'function') return String(requestName(req));
    if (typeof requestName === 'string' && requestName.trim()) return requestName.trim();
    const method = (req.method || 'REQ').toUpperCase();
    const path   = req.path || req.url || '/';
    return `${method} ${path}`;
  } catch (_) {
    return 'HTTP request';
  }
}

/**
 * Express / Connect middleware that starts a root trace span for every
 * incoming HTTP request.
 *
 * Every function wrapped with traceAll() or withTrace() called during the
 * request will automatically become a child span of this root.
 *
 * Options:
 *   requestName {string|Function}  — static name or (req) => string
 *                                    defaults to "METHOD /path"
 *   logRequests {boolean}          — log request enter/exit (default: true)
 *   logger      {object}           — logger to use for request logs
 *                                    (must have .info() and .error())
 *
 * @param {object}  [opts]
 * @param {string|Function} [opts.requestName]
 * @param {boolean} [opts.logRequests=true]
 * @param {object}  [opts.logger]
 * @returns {Function} Express middleware (req, res, next)
 */
function expressMiddleware(opts = {}) {
  if (typeof opts !== 'object' || opts === null) opts = {};

  const logRequests = opts.logRequests !== false; // default true
  const log         = opts.logger || null;

  return function fnTracerMiddleware(req, res, next) {
    const traceName = resolveTraceName(req, opts.requestName);
    const context   = buildRootContext(traceName);

    storage.run(context, () => {
      if (logRequests && log) {
        try { log.info(traceName, { status: 'enter' }); } catch (_) {}
      }

      if (logRequests && log) {
        // Log exit when the response finishes
        res.on('finish', () => {
          const duration = Date.now() - context.startTime;
          const status   = res.statusCode >= 400 ? 'error' : 'exit';
          try {
            log[status === 'error' ? 'error' : 'info'](traceName, {
              status,
              duration,
              httpStatus: res.statusCode,
            });
          } catch (_) {}
        });
      }

      next();
    });
  };
}

/**
 * Fastify plugin that starts a root trace span for every incoming request.
 *
 * Usage:
 *   fastify.register(require('fn-tracer').fastifyPlugin);
 *   // or with options:
 *   fastify.register(require('fn-tracer').fastifyPlugin, { logRequests: true, logger });
 *
 * @param {object} fastify
 * @param {object} opts
 * @param {Function} done
 */
function fastifyPlugin(fastify, opts, done) {
  if (typeof opts !== 'object' || opts === null) opts = {};

  const logRequests = opts.logRequests !== false;
  const log         = opts.logger || null;

  fastify.addHook('onRequest', (request, reply, hookDone) => {
    const traceName = resolveTraceName(request.raw || request, opts.requestName);
    const context   = buildRootContext(traceName);

    // Run the rest of the request lifecycle inside the ALS context
    storage.run(context, () => {
      if (logRequests && log) {
        try { log.info(traceName, { status: 'enter' }); } catch (_) {}
      }
      hookDone();
    });
  });

  if (logRequests && log) {
    fastify.addHook('onResponse', (request, reply, hookDone) => {
      const ctx = storage.getStore();
      if (ctx) {
        const duration = Date.now() - ctx.startTime;
        const status   = reply.statusCode >= 400 ? 'error' : 'exit';
        try {
          log[status === 'error' ? 'error' : 'info'](ctx.rootFunctionName, {
            status,
            duration,
            httpStatus: reply.statusCode,
          });
        } catch (_) {}
      }
      hookDone();
    });
  }

  done();
}

// Mark as fastify plugin so it can be registered with fastify.register()
fastifyPlugin[Symbol.for('skip-override')] = true;
fastifyPlugin[Symbol.for('fastify.display-name')] = 'fn-tracer';

module.exports = { expressMiddleware, fastifyPlugin };
