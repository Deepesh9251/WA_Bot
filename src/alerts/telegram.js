'use strict';

// ──────────────────────────────────────────────────────────────────
// alerts/telegram.js — Send alert messages to the owner via Telegram
//
// Uses native fetch (Node 18+) to POST to the Telegram Bot API.
// All messages are prefixed with [WA-Bot] for easy filtering.
//
// CRITICAL: This function MUST NEVER THROW. If the Telegram request
// fails, we log the error and move on — a failed alert must not
// crash the bot or interrupt the deletion flow.
// ──────────────────────────────────────────────────────────────────

const config = require('../config');
const logger = require('../logger');

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MESSAGE_PREFIX = '[WA-Bot]';

/**
 * Sends a text message to the owner's Telegram chat.
 *
 * @param {string} message - The alert message body (plain text)
 * @returns {Promise<void>}
 */
async function sendTelegramAlert(message) {
  const fullMessage = `${MESSAGE_PREFIX} ${message}`;

  try {
    const url = `${TELEGRAM_API_BASE}/bot${config.telegramBotToken}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text: fullMessage,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.warn(`Telegram alert failed (HTTP ${response.status}): ${body}`);
    }
    // Success — no return value needed
  } catch (err) {
    // Never let a failed alert crash the bot
    logger.error(`Failed to send Telegram alert (will not retry):`, err.message);
  }
}

module.exports = { sendTelegramAlert };

// ──────────────────────────────────────────────────────────────────
// MANUAL TEST — run with real credentials in .env:
//   node src/alerts/telegram.js
// Expected: you receive a Telegram message from your bot.
// ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    console.log('Sending test Telegram alert...');
    await sendTelegramAlert('Test alert from bot setup ✅ — if you see this, Telegram is working!');
    console.log('Done. Check your Telegram.');
  })();
}
