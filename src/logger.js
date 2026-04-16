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
 * @param {string}  [opts.level='debug']                    Minimum log level to emit
 * @param {'pretty'|'json'} [opts.format='pretty']          Output format
 * @param {any[]}   [opts.transports]                       Override Winston transports (defaults to Console)
 * @param {Record<string, string | { label: string, color: string }>} [opts.badges]  Custom level badges
 * @returns {import('winston').Logger}
 */
// Custom levels that extend Winston's defaults with 'notice' (between info and warn)
const customLevels = {
  levels: {
    error:   0,
    warn:    1,
    notice:  2,
    info:    3,
    http:    4,
    verbose: 5,
    debug:   6,
    silly:   7,
  },
  colors: {
    error:   'red',
    warn:    'yellow',
    notice:  'cyan',
    info:    'green',
    http:    'magenta',
    verbose: 'white',
    debug:   'blue',
    silly:   'grey',
  },
};

function createLogger(opts = {}) {
  if (typeof opts !== 'object' || opts === null) opts = {};

  const winston    = requireWinston();
  const { prettyFormat, jsonFormat } = require('./formats');

  winston.addColors(customLevels.colors);

  const level      = typeof opts.level === 'string'  ? opts.level  : 'debug';
  const formatName = opts.format === 'json'          ? 'json'      : 'pretty';
  const transports = Array.isArray(opts.transports)  ? opts.transports : [new winston.transports.Console()];
  const badges     = opts.badges && typeof opts.badges === 'object' ? opts.badges : null;

  const logFormat = formatName === 'json'
    ? winston.format.combine(winston.format.errors({ stack: true }), jsonFormat(winston))
    : winston.format.combine(winston.format.errors({ stack: true }), prettyFormat(winston, badges));

  return winston.createLogger({ levels: customLevels.levels, level, format: logFormat, transports });
}

module.exports = { createLogger };
