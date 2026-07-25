'use strict';

// ──────────────────────────────────────────────────────────────────
// index.js — Bot entry point
//
// Initializes the WhatsApp client, wires up all event handlers,
// and starts the message monitoring loop.
//
// STARTUP MODES:
//   A) Normal mode  — TARGET_GROUP_ID is set in .env
//      → Bot connects, listens for Instagram links, deletes them.
//
//   B) Discovery mode — TARGET_GROUP_ID is blank/unset
//      → After connecting, the bot lists all group names + IDs,
//        then exits. Use this to find your group's ID on first run.
// ──────────────────────────────────────────────────────────────────

const { Client, LocalAuth } = require('whatsapp-web.js');
const http = require('http');
const QRCode = require('qrcode');

const config = require('./config');
const logger = require('./logger');
const { isInstagramLinkOnly } = require('./linkDetector');
const { deleteMatchedMessage } = require('./deleteHandler');
const { sendTelegramAlert } = require('./alerts/telegram');
const { startHeartbeat } = require('./alerts/healthcheck');

// ── HTTP Keep-Alive & Web QR Server ──────────────────────────────
let latestQrDataUrl = null;

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  if (latestQrDataUrl) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WhatsApp Bot — Scan QR Code</title>
          <meta http-equiv="refresh" content="5">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; background: #0f172a; color: #fff; padding: 40px 20px; }
            .card { background: #1e293b; max-width: 360px; margin: 0 auto; padding: 30px 20px; border-radius: 16px; box-shadow: 0 20px 30px rgba(0,0,0,0.5); }
            img { background: #fff; padding: 15px; border-radius: 12px; width: 240px; height: 240px; margin: 20px 0; }
            h2 { color: #22c55e; margin-top: 0; }
            p { color: #94a3b8; font-size: 14px; }
            .badge { background: #334155; color: #e2e8f0; padding: 6px 12px; border-radius: 20px; font-size: 12px; display: inline-block; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>📱 Scan to Connect Bot</h2>
            <p>Open WhatsApp &rarr; Linked Devices &rarr; Link a Device</p>
            <img src="${latestQrDataUrl}" alt="WhatsApp QR Code" />
            <div><span class="badge">Auto-refreshes every 5 seconds</span></div>
          </div>
        </body>
      </html>
    `);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
    <!DOCTYPE html>
    <html>
      <head><title>WhatsApp Bot Active</title></head>
      <body style="font-family:-apple-system,sans-serif;text-align:center;background:#0f172a;color:#22c55e;padding-top:80px;">
        <h1 style="font-size:28px;">WhatsApp Link Deleter Bot is Active 24/7 ✅</h1>
        <p style="color:#94a3b8;font-size:16px;">Session is authenticated and monitoring groups.</p>
      </body>
    </html>
  `);
}).listen(PORT, () => {
  logger.info(`HTTP Keep-Alive & Web QR server listening on port ${PORT}`);
});

// ── WhatsApp Client Setup ─────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    ...(process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-extensions',
      '--js-flags="--max-old-space-size=256"',
    ],
  },
});

// ── Event: QR Code ────────────────────────────────────────────────
let hasLoggedQrNotice = false;

client.on('qr', async (qr) => {
  try {
    latestQrDataUrl = await QRCode.toDataURL(qr);
  } catch (e) {}

  if (!hasLoggedQrNotice) {
    logger.info('QR Code ready — scan cleanly at app URL (https://wa-bot-rc6r.onrender.com)');
    hasLoggedQrNotice = true;
  }
});

// ── Event: Ready ──────────────────────────────────────────────────
client.on('ready', async () => {
  latestQrDataUrl = null; // Clear QR page when authenticated
  hasLoggedQrNotice = false;
  logger.info('Bot connected and ready ✅');
  await sendTelegramAlert('Bot connected and ready ✅');

  // ── Event: Disconnected ───────────────────────────────────────────
  client.on('disconnected', async (reason) => {
    logger.warn(`WhatsApp client disconnected: ${reason}`);
    await sendTelegramAlert(`⚠️ WhatsApp bot disconnected: ${reason}`);
  });

  // ── DISCOVERY MODE ──────────────────────────────────────────────
  // If TARGET_GROUP_ID is not set, list all groups and exit.
  // The user copies the right ID into .env, then restarts the bot.
  if (!config.targetGroupId) {
    logger.warn('TARGET_GROUP_ID is not set — running in discovery mode.');
    logger.warn('Waiting a few seconds for WhatsApp to fully load...');

    // Small delay — WhatsApp Web needs a moment after "ready" before getChats works
    await new Promise((resolve) => setTimeout(resolve, 4000));

    logger.warn('Listing all groups the bot account is a member of:');
    logger.warn('─'.repeat(60));

    const chats = await client.getChats();
    const groups = chats.filter((chat) => chat.isGroup);

    if (groups.length === 0) {
      logger.warn('No groups found. Make sure the bot account has been added to at least one WhatsApp group.');
    } else {
      for (const group of groups) {
        logger.warn(`Group: "${group.name}" | ID: ${group.id._serialized}`);
      }
    }

    logger.warn('─'.repeat(60));
    logger.warn('Set TARGET_GROUP_ID in your .env to one of the IDs above, then restart.');
    await client.destroy();
    process.exit(0);
  }

  // ── NORMAL MODE ─────────────────────────────────────────────────
  const targetGroupIds = config.targetGroupId && config.targetGroupId !== 'ALL' && config.targetGroupId !== '*'
    ? config.targetGroupId.split(',').map((s) => s.trim())
    : null; // null means monitor ALL groups

  if (targetGroupIds && targetGroupIds.length > 0) {
    logger.info(`Monitoring specific group(s): ${targetGroupIds.join(', ')}`);
  } else {
    logger.info(`Monitoring ALL WhatsApp groups where bot is a member 🚀`);
  }

  // Start the dead-man's-switch heartbeat only after we're confirmed connected
  startHeartbeat();

  // ── Event: Message Created ────────────────────────────────────────
  // Fires for ALL messages seen by the client, including the bot's own.
  client.on('message_create', async (message) => {
    // Guard 1: Must be a group message (JID ends with @g.us)
    if (!message.from || !message.from.endsWith('@g.us')) return;

    // If specific target groups are specified, enforce the filter
    if (targetGroupIds && !targetGroupIds.includes(message.from)) return;

    // Guard 2: Never try to delete the bot's own messages
    if (message.fromMe) return;

    // Guard 3: Only act on text messages (ignore media-only messages with no caption)
    const body = message.body || '';

    if (isInstagramLinkOnly(body)) {
      logger.info(`Instagram-only link detected from ${message.author || message.from} — deleting...`);
      await deleteMatchedMessage(message);
    }
  });
});

// ── Start the client ──────────────────────────────────────────────
logger.info('Initializing WhatsApp client...');
client.initialize();
