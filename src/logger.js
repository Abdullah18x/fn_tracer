'use strict';

// Winston is an optional peer dependency.
// We load it lazily and emit a clear error if it's missing.
function requireWinston() {
  try {
    return require('winston');
  } catch (_) {
    throw new Error(
      '[fn-tracer] The built-in logger requires winston. ' +
      'Install it with:  npm install winston\n' +
      'Alternatively, pass your own logger to createTracer({ logger: yourLogger }).'
    );
  }
}

/**
 * Creates a Winston logger pre-configured for trace-aware output.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.level='debug']          Minimum log level to emit
 * @param {'pretty'|'json'} [opts.format='pretty'] Output format
 * @param {any[]}   [opts.transports]              Override Winston transports (defaults to Console)
 * @returns {import('winston').Logger}
 */
function createLogger(opts = {}) {
  const winston    = requireWinston();
  const { prettyFormat, jsonFormat } = require('./formats');

  const level      = opts.level   || 'debug';
  const formatName = opts.format  || 'pretty';
  const transports = opts.transports || [new winston.transports.Console()];

  if (formatName !== 'pretty' && formatName !== 'json') {
    throw new TypeError(
      `createLogger: format must be "pretty" or "json", got "${formatName}"`
    );
  }

  const logFormat = formatName === 'json'
    ? winston.format.combine(winston.format.errors({ stack: true }), jsonFormat(winston))
    : winston.format.combine(winston.format.errors({ stack: true }), prettyFormat(winston));

  return winston.createLogger({ level, format: logFormat, transports });
}

module.exports = { createLogger };
