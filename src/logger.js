'use strict';

// ──────────────────────────────────────────────────────────────────
// logger.js — Minimal timestamped console logger
//
// Intentionally simple: no external library (no winston/pino).
// Every line is prefixed with an ISO 8601 timestamp + level tag.
// Example output:
//   [2026-07-26T02:01:00.123Z] [INFO]  Bot connected and ready
//   [2026-07-26T02:01:01.456Z] [ERROR] Failed to delete message: ...
// ──────────────────────────────────────────────────────────────────

function timestamp() {
  return new Date().toISOString();
}

const envTag = (process.env.APP_ENV || process.env.NODE_ENV || (process.env.RENDER ? 'PROD' : 'DEV')).toUpperCase();

const logger = {
  info(message, ...args) {
    console.log(`[${timestamp()}] [${envTag}] [INFO] `, message, ...args);
  },

  warn(message, ...args) {
    console.warn(`[${timestamp()}] [${envTag}] [WARN] `, message, ...args);
  },

  error(message, ...args) {
    console.error(`[${timestamp()}] [${envTag}] [ERROR]`, message, ...args);
  },
};

module.exports = logger;
