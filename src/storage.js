'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

// Single shared AsyncLocalStorage instance for the entire process.
// Exported as a singleton so all withTrace/traceAll calls share the same
// async context tree regardless of which module imports this file.
const storage = new AsyncLocalStorage();

module.exports = storage;
