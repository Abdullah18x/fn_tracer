'use strict';

const crypto = require('node:crypto');

/**
 * Builds a root context object — used when no trace is currently active.
 * This function call becomes the origin of a new trace tree.
 *
 * @param {string} functionName
 * @returns {import('../types').TraceContext}
 */
function buildRootContext(functionName) {
  const spanId = crypto.randomUUID();
  return {
    traceId:             crypto.randomUUID(),
    spanId,
    rootSpanId:          spanId,
    rootFunctionName:    functionName,
    currentFunctionName: functionName,
    parentFunctionName:  null,
    depth:               0,
    startTime:           Date.now(),
    path:                [functionName],
  };
}

/**
 * Builds a child context object — used when a trace is already active.
 * Inherits traceId from the parent; everything else is fresh for this span.
 *
 * @param {import('../types').TraceContext} parent
 * @param {string} functionName
 * @returns {import('../types').TraceContext}
 */
function buildChildContext(parent, functionName) {
  return {
    traceId:             parent.traceId,
    spanId:              crypto.randomUUID(),
    rootSpanId:          parent.rootSpanId,
    rootFunctionName:    parent.rootFunctionName,
    currentFunctionName: functionName,
    parentFunctionName:  parent.currentFunctionName,
    depth:               parent.depth + 1,
    startTime:           Date.now(),
    path:                [...parent.path, functionName],
  };
}

module.exports = { buildRootContext, buildChildContext };
