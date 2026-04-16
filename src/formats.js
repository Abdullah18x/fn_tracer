'use strict';

const { getContext } = require('./tracer');

// ── ANSI helpers ──────────────────────────────────────────────────────────────

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

// ── Level badges ──────────────────────────────────────────────────────────────

const DEFAULT_LEVEL_BADGES = {
  error:   c(A.bold + A.red,     ' ERROR '),
  warn:    c(A.bold + A.yellow,  '  WARN '),
  info:    c(A.bold + A.green,   '  INFO '),
  debug:   c(A.bold + A.blue,    ' DEBUG '),
  verbose: c(A.bold + A.cyan,    '  VERB '),
};

/**
 * Merges user-supplied badge definitions with the defaults.
 * Each entry can be:
 *   - a plain string label  e.g. { notice: 'NOTE' }  → rendered with default styling
 *   - an already-styled ANSI string  e.g. { notice: '\x1b[35mNOTE\x1b[0m' }
 *   - an object { label, color } where color is one of the A keys
 *     e.g. { notice: { label: 'NOTE', color: 'magenta' } }
 *
 * @param {Record<string, string | { label: string, color: string }>} [customBadges]
 * @returns {Record<string, string>}
 */
function buildBadges(customBadges) {
  const badges = { ...DEFAULT_LEVEL_BADGES };
  if (!customBadges || typeof customBadges !== 'object') return badges;
  for (const [level, value] of Object.entries(customBadges)) {
    if (typeof value === 'string') {
      // Plain string — pad to 7 chars for alignment and apply bold white
      badges[level] = c(A.bold + A.white, value.padStart(7));
    } else if (value && typeof value === 'object' && value.label) {
      const ansiColor = A[value.color] || '';
      badges[level] = c(A.bold + ansiColor, value.label.padStart(7));
    }
  }
  return badges;
}

const SPAN_BADGE = {
  enter: c(A.bold + A.green,  ' → '),
  exit:  c(A.bold + A.cyan,   ' ← '),
  error: c(A.bold + A.red,    ' ✖ '),
};

// ── Pretty format (human-readable, coloured) ──────────────────────────────────

/**
 * Returns a Winston format.printf that renders coloured, indented trace logs.
 * getContext() is called at log-emit time so the context is always current.
 *
 * @param {object} winston - the winston module (passed in to avoid a hard dep at format level)
 * @returns {import('winston').Logform.Format}
 */
function prettyFormat(winston, customBadges) {
  const LEVEL_BADGE = buildBadges(customBadges);
  return winston.format.printf((info) => {
    const ctx    = getContext();
    const status = info.status || '';

    const traceId = ctx ? c(A.bold + A.cyan,    shortId(ctx.traceId)) : c(A.gray, '--------');
    const spanId  = ctx ? c(A.magenta,          shortId(ctx.spanId))  : c(A.gray, '--------');
    const depth   = ctx ? ctx.depth : 0;
    const indent  = '  '.repeat(depth);
    const pathStr = ctx
      ? c(A.dim + A.gray, ctx.path.join(' › '))
      : c(A.dim + A.gray, 'outside trace');

    const ts      = c(A.gray, timestamp());
    const level   = LEVEL_BADGE[info.level] || LEVEL_BADGE.info;
    const duration = info.duration != null ? c(A.bold + A.yellow, ` ${info.duration}ms`) : '';

    let msg;
    if (status === 'enter') {
      msg = `${SPAN_BADGE.enter}${indent}${c(A.bold + A.white, info.message)}`;
    } else if (status === 'exit') {
      msg = `${SPAN_BADGE.exit}${indent}${c(A.white, info.message)}${duration}`;
    } else if (status === 'error') {
      msg = `${SPAN_BADGE.error}${indent}${c(A.bold + A.red, info.message)}${duration}`;
    } else {
      msg = `   ${indent}${info.message}`;
    }

    let line = `${ts}  ${level}  [${traceId}][${spanId}]  ${msg}`;

    if (ctx) {
      line += `  ${c(A.dim, `(${pathStr})`)}`;
    }

    if (info.errorMessage) {
      line += `\n${' '.repeat(12)}  ${c(A.bold + A.red, '⚠')}  ${c(A.red, info.errorMessage)}`;
    }

    return line;
  });
}

// ── JSON format (machine-readable, for log aggregators) ───────────────────────

/**
 * Returns a Winston format.printf that emits one JSON object per line.
 * All trace context fields are included as top-level keys so log aggregators
 * (Datadog, Loki, CloudWatch Logs Insights) can filter by traceId/spanId directly.
 *
 * @param {object} winston
 * @returns {import('winston').Logform.Format}
 */
function jsonFormat(winston) {
  return winston.format.printf((info) => {
    try {
      const ctx = getContext();
      const entry = {
        timestamp: new Date().toISOString(),
        level:     info.level,
        message:   info.message,
        traceId:             ctx ? ctx.traceId             : undefined,
        spanId:              ctx ? ctx.spanId              : undefined,
        rootSpanId:          ctx ? ctx.rootSpanId          : undefined,
        rootFunctionName:    ctx ? ctx.rootFunctionName    : undefined,
        currentFunctionName: ctx ? ctx.currentFunctionName : undefined,
        parentFunctionName:  ctx ? ctx.parentFunctionName  : undefined,
        depth:               ctx ? ctx.depth               : undefined,
        path:                ctx ? ctx.path.join(' > ')    : undefined,
        status:       info.status       || undefined,
        duration:     info.duration     != null ? info.duration : undefined,
        errorMessage: info.errorMessage || undefined,
        errorStack:   info.errorStack   || undefined,
      };
      return JSON.stringify(entry, (_, v) => v === undefined ? undefined : v);
    } catch (_) {
      return JSON.stringify({ level: info.level || 'info', message: String(info.message || '') });
    }
  });
}

module.exports = { prettyFormat, jsonFormat, buildBadges, ANSI: A };
