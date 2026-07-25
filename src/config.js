'use strict';

// ──────────────────────────────────────────────────────────────────
// config.js — Centralized environment variable loader & validator
//
// All process.env reads happen here. The rest of the app imports
// this module and uses the exported `config` object — no scattered
// process.env calls anywhere else.
// ──────────────────────────────────────────────────────────────────

require('dotenv').config();

// Variables that MUST be present for the bot to start.
// TARGET_GROUP_ID is intentionally omitted — it's optional on first
// run so the user can discover their group ID (see index.js).
const REQUIRED_VARS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'HEALTHCHECK_PING_URL',
];

// Check for missing required vars and exit clearly if any are absent.
const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `[CONFIG ERROR] The following required environment variables are not set:\n` +
    missing.map((k) => `  - ${k}`).join('\n') +
    `\n\nCopy .env.example to .env and fill in all values before starting the bot.`
  );
  process.exit(1);
}

const config = {
  // Telegram alerting
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,

  // Healthchecks.io dead-man's-switch
  healthcheckPingUrl: process.env.HEALTHCHECK_PING_URL,

  // WhatsApp target group — 'ALL' (default) monitors every group the bot is in
  targetGroupId: process.env.TARGET_GROUP_ID || 'ALL',
};

module.exports = config;
