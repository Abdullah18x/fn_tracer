'use strict';

// Winston is an optional peer dependency.
// We load it lazily and fall back to a built-in console logger if missing.
function requireWinston() {
  try {
    return require('winston');
  } catch (_) {
    return null;
  }
}

// ── ANSI helpers (duplicated from formats.js to keep logger self-contained) ───

const A = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  gray:    '\x1b[90m',
};
const c = (code, str) => `${code}${str}${A.reset}`;

const FALLBACK_BADGES = {
  error:   c(A.bold + A.red,     ' ERROR '),
  warn:    c(A.bold + A.yellow,  '  WARN '),
  notice:  c(A.bold + A.cyan,    'NOTICE '),
  info:    c(A.bold + A.green,   '  INFO '),
  debug:   c(A.bold + A.blue,    ' DEBUG '),
  verbose: c(A.bold + A.cyan,    '  VERB '),
  silly:   c(A.bold + A.gray,    ' SILLY '),
};

function shortId(uuid) {
  return typeof uuid === 'string' ? uuid.slice(0, 8) : '--------';
}

function timestamp() {
  const now = new Date();
  return (
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0') + ':' +
    String(now.getSeconds()).padStart(2, '0') + '.' +
    String(now.getMilliseconds()).padStart(3, '0')
  );
}

/**
 * Minimal console-based fallback logger used when Winston is not installed.
 * Produces the same coloured pretty output as the Winston-based logger.
 *
 * @param {object} [opts]
 * @param {string} [opts.level]
 * @returns {object} logger-compatible object
 */
function createFallbackLogger(opts = {}) {
  const { getContext } = require('./tracer');
  const minLevel = opts.level || 'debug';

  const LEVELS = { error: 0, warn: 1, notice: 2, info: 3, http: 4, verbose: 5, debug: 6, silly: 7 };
  const minPriority = LEVELS[minLevel] ?? 6;

  function log(level, message, meta = {}) {
    try {
      if ((LEVELS[level] ?? 6) > minPriority) return;

      const ctx    = getContext();
      const status = meta.status || '';
      const traceId = ctx ? c(A.bold + A.cyan,  shortId(ctx.traceId)) : c(A.gray, '--------');
      const spanId  = ctx ? c(A.magenta,         shortId(ctx.spanId))  : c(A.gray, '--------');
      const depth   = ctx ? ctx.depth : 0;
      const indent  = '  '.repeat(depth);
      const pathStr = ctx ? c(A.dim + A.gray, ctx.path.join(' › ')) : c(A.dim + A.gray, 'outside trace');
      const badge   = FALLBACK_BADGES[level] || c(A.bold + A.white, String(level).padStart(7));
      const ts      = c(A.gray, timestamp());
      const duration = meta.duration != null ? c(A.bold + A.yellow, ` ${meta.duration}ms`) : '';

      let msg;
      if (status === 'enter')      msg = ` ${c(A.bold + A.green, '→')} ${indent}${c(A.bold + A.white, message)}`;
      else if (status === 'exit')  msg = ` ${c(A.bold + A.cyan,  '←')} ${indent}${c(A.white, message)}${duration}`;
      else if (status === 'error') msg = ` ${c(A.bold + A.red,   '✖')} ${indent}${c(A.bold + A.red, message)}${duration}`;
      else                         msg = `    ${indent}${message}`;

      let line = `${ts}  ${badge}  [${traceId}][${spanId}]  ${msg}`;
      if (ctx) line += `  ${c(A.dim, `(${pathStr})`)}`;
      if (meta.errorMessage) line += `\n            ${c(A.bold + A.red, '⚠')}  ${c(A.red, meta.errorMessage)}`;

      const out = level === 'error' ? console.error : console.log;
      out(line);
    } catch (_) {
      console.log(`[fn-tracer] ${level}: ${message}`);
    }
  }

  // Build a logger object with a method for every known level
  const logger = {};
  for (const level of Object.keys(LEVELS)) {
    logger[level] = (message, meta) => log(level, message, meta);
  }
  return logger;
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

  const winston = requireWinston();

  // ── No Winston installed — use the built-in console fallback ─────────────
  if (!winston) {
    return createFallbackLogger({ level: typeof opts.level === 'string' ? opts.level : 'debug' });
  }

  // ── Winston available — use it ────────────────────────────────────────────
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
