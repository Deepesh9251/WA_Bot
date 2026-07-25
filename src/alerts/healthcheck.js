'use strict';

// ──────────────────────────────────────────────────────────────────
// alerts/healthcheck.js — Dead-man's-switch heartbeat to healthchecks.io
//
// The bot pings a unique URL every 5 minutes after the WhatsApp
// client reports "ready". If the ping stops arriving, healthchecks.io
// sends an email alert to the owner (silent failure detection).
//
// Call startHeartbeat() ONLY after the WhatsApp `ready` event fires —
// this way the ping represents "bot is actually connected", not just
// "process started".
// ──────────────────────────────────────────────────────────────────

const config = require('../config');
const logger = require('../logger');

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Sends a single ping to healthchecks.io.
 * Wrapped in its own function so it can be called immediately on
 * `ready` and then on each interval.
 */
async function ping() {
  try {
    const response = await fetch(config.healthcheckPingUrl);
    if (!response.ok) {
      logger.warn(`Healthcheck ping returned HTTP ${response.status}`);
    }
  } catch (err) {
    // Never crash the bot over a failed heartbeat
    logger.error('Healthcheck ping failed (will retry on next interval):', err.message);
  }
}

/**
 * Starts the recurring heartbeat interval.
 * Also sends one immediate ping so the check goes green right away.
 *
 * @returns {NodeJS.Timeout} The interval handle (for cleanup if needed)
 */
function startHeartbeat() {
  logger.info('Starting healthcheck heartbeat (every 5 minutes)');

  // Ping immediately on connection, then every 5 minutes
  ping();
  const handle = setInterval(ping, HEARTBEAT_INTERVAL_MS);

  return handle;
}

module.exports = { startHeartbeat };

// ──────────────────────────────────────────────────────────────────
// MANUAL TEST — run with real .env:
//   node src/alerts/healthcheck.js
// Expected: one ping fires, check goes green on healthchecks.io dashboard
// ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    console.log('Sending single healthcheck ping...');
    await ping();
    console.log('Done. Check your healthchecks.io dashboard for a green status.');
    process.exit(0);
  })();
}
