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

const fs = require('fs');
const http = require('http');
const QRCode = require('qrcode');

const config = require('./config');
const logger = require('./logger');
const { isInstagramLinkOnly } = require('./linkDetector');
const { deleteMatchedMessage, recentDeletedLogs } = require('./deleteHandler');
const { sendTelegramAlert } = require('./alerts/telegram');
const { startHeartbeat } = require('./alerts/healthcheck');

// ── Global Process Safety Handlers ─────────────────────────────────
// Prevents container crash from background file stream events (e.g., RemoteAuth.zip)
process.on('uncaughtException', (err) => {
  if (err && (err.code === 'ENOENT' || (err.message && err.message.includes('RemoteAuth')))) {
    logger.warn(`Handled background RemoteAuth sync file notice: ${err.message}`);
    return;
  }
  logger.error(`Uncaught exception: ${err.stack || err.message}`);
});

process.on('unhandledRejection', (reason) => {
  logger.warn(`Unhandled rejection: ${reason && reason.stack ? reason.stack : reason}`);
});

// ── HTTP Keep-Alive & Web Dashboard Server ────────────────────────
let latestQrDataUrl = null;
let botStatus = 'INITIALIZING'; // INITIALIZING | QR_READY | AUTHENTICATED
const startTime = new Date();

const PORT = process.env.PORT || 3000;
http.createServer(async (req, res) => {
  // API Route: Test Telegram Alert
  if (req.url === '/api/test-telegram') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      await sendTelegramAlert('🔔 Test Alert from WhatsApp Bot Cloud Dashboard');
      res.end(JSON.stringify({ success: true, message: 'Telegram test alert sent!' }));
    } catch (e) {
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  // API Route: Recent Deleted Logs JSON
  if (req.url === '/api/logs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(recentDeletedLogs));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

  if (botStatus === 'QR_READY' && latestQrDataUrl) {
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>WhatsApp Bot — Scan QR Code</title>
          <meta http-equiv="refresh" content="5">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; background: #0f172a; color: #fff; padding: 40px 20px; }
            .card { background: #1e293b; max-width: 380px; margin: 0 auto; padding: 30px 24px; border-radius: 16px; box-shadow: 0 20px 30px rgba(0,0,0,0.5); border: 1px solid #334155; }
            img { background: #fff; padding: 15px; border-radius: 12px; width: 240px; height: 240px; margin: 20px 0; }
            h2 { color: #22c55e; margin-top: 0; }
            p { color: #94a3b8; font-size: 14px; }
            .btn { background: #22c55e; color: #0f172a; font-weight: bold; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 15px; width: 100%; transition: opacity 0.2s; }
            .btn:hover { opacity: 0.9; }
            .badge { background: #334155; color: #e2e8f0; padding: 6px 12px; border-radius: 20px; font-size: 12px; display: inline-block; margin-top: 15px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>📱 Scan to Connect Bot</h2>
            <p>Open WhatsApp &rarr; Linked Devices &rarr; Link a Device</p>
            <img src="${latestQrDataUrl}" alt="WhatsApp QR Code" />
            <div>
              <button class="btn" onclick="window.location.reload()">Refresh QR Code 🔄</button>
            </div>
            <div><span class="badge">Auto-refreshes every 5 seconds</span></div>
          </div>
        </body>
      </html>
    `);
    return;
  }

  if (botStatus === 'AUTHENTICATED') {
    const isProd = Boolean(process.env.RENDER || process.env.NODE_ENV === 'production');
    const envTag = isProd ? 'PROD ☁️' : 'DEV 💻';
    const uptimeMins = Math.floor((new Date() - startTime) / 60000);

    let logsHtmlRows = '';
    if (recentDeletedLogs.length === 0) {
      logsHtmlRows = '<tr><td colspan="4" style="color:#64748b;font-style:italic;padding:20px 0;text-align:center;">No reels deleted yet since boot. Watching groups 24/7...</td></tr>';
    } else {
      logsHtmlRows = recentDeletedLogs.map(item => `
        <tr style="border-bottom: 1px solid #334155;">
          <td style="padding: 10px; color:#94a3b8; font-size:13px;">${item.timestamp}</td>
          <td style="padding: 10px; color:#f1f5f9; font-weight:600; font-size:13px;">${item.sender}</td>
          <td style="padding: 10px; color:#38bdf8; font-size:13px;">${item.group}</td>
          <td style="padding: 10px; font-weight: 500; font-size:13px;"><a href="${item.url}" target="_blank" style="color:#e2e8f0;text-decoration:underline;">${item.url}</a></td>
        </tr>
      `).join('');
    }

    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>WhatsApp Bot — Dashboard</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 30px 20px; }
            .container { max-width: 860px; margin: 0 auto; }
            .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 30px; }
            h1 { font-size: 24px; margin: 0; color: #f8fafc; }
            .status-badge { background: rgba(34,197,94,0.15); color: #22c55e; border: 1px solid rgba(34,197,94,0.3); padding: 6px 14px; border-radius: 20px; font-size: 14px; font-weight: 600; display: inline-flex; align-items: center; gap: 8px; }
            .pulse { width: 8px; height: 8px; background: #22c55e; border-radius: 50%; box-shadow: 0 0 10px #22c55e; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 30px; }
            .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 18px; }
            .card-title { color: #94a3b8; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
            .card-value { font-size: 16px; font-weight: 700; color: #f1f5f9; }
            .btn-group { display: flex; gap: 12px; margin-bottom: 30px; }
            .btn { background: #334155; color: #f8fafc; border: 1px solid #475569; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.2s; }
            .btn:hover { background: #475569; }
            .btn-primary { background: #0284c7; border-color: #0369a1; }
            .btn-primary:hover { background: #0369a1; }
            .logs-container { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; overflow-x: auto; }
            table { width: 100%; border-collapse: collapse; text-align: left; }
            th { color: #94a3b8; font-size: 12px; text-transform: uppercase; padding: 10px; border-bottom: 1px solid #334155; }
            #toast { display: none; background: #22c55e; color: #0f172a; font-weight: bold; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <div id="toast"></div>

            <div class="header">
              <div>
                <h1>WhatsApp Link Deleter</h1>
                <p style="color:#94a3b8;margin:4px 0 0 0;font-size:14px;">Cloud Worker Dashboard &bull; Uptime: ${uptimeMins}m</p>
              </div>
              <div class="status-badge"><span class="pulse"></span> Active 24/7</div>
            </div>

            <div class="btn-group">
              <button class="btn btn-primary" onclick="testTelegram()">Test Telegram Alert 🔔</button>
              <button class="btn" onclick="window.location.reload()">Refresh Status 🔄</button>
            </div>

            <div class="grid">
              <div class="card">
                <div class="card-title">Environment</div>
                <div class="card-value" style="color:${isProd ? '#a855f7' : '#f59e0b'};">${envTag}</div>
              </div>
              <div class="card">
                <div class="card-title">Target Mode</div>
                <div class="card-value" style="color:#38bdf8;">Zero-Config (ALL)</div>
              </div>
              <div class="card">
                <div class="card-title">Log Retention</div>
                <div class="card-value">30-Day Auto Rotate</div>
              </div>
              <div class="card">
                <div class="card-title">Heartbeat Pinger</div>
                <div class="card-value" style="color:#22c55e;">Healthchecks OK</div>
              </div>
            </div>

            <div class="logs-container">
              <h3 style="margin:0 0 15px 0;font-size:16px;color:#f8fafc;">Recent Deleted Instagram Links</h3>
              <table>
                <thead>
                  <tr>
                    <th>Sent Time</th>
                    <th>Sender Name</th>
                    <th>Group Name</th>
                    <th>Deleted Reel Link</th>
                  </tr>
                </thead>
                <tbody>
                  ${logsHtmlRows}
                </tbody>
              </table>
            </div>
          </div>

          <script>
            async function testTelegram() {
              const toast = document.getElementById('toast');
              toast.style.display = 'block';
              toast.innerText = 'Sending test Telegram notification...';
              try {
                const res = await fetch('/api/test-telegram');
                const data = await res.json();
                if (data.success) {
                  toast.innerText = '✅ Test alert sent to your Telegram DM!';
                } else {
                  toast.innerText = '❌ Failed: ' + data.error;
                }
              } catch (e) {
                toast.innerText = '❌ Request failed';
              }
              setTimeout(() => { toast.style.display = 'none'; }, 4000);
            }
          </script>
        </body>
      </html>
    `);
    return;
  }

  // Initializing state
  res.end(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>WhatsApp Bot Initializing</title>
        <meta http-equiv="refresh" content="3">
      </head>
      <body style="font-family:-apple-system,sans-serif;text-align:center;background:#0f172a;color:#38bdf8;padding-top:80px;">
        <h1 style="font-size:28px;">⏳ Initializing WhatsApp Web...</h1>
        <p style="color:#94a3b8;font-size:16px;">Launching Chromium browser. QR code page will load in a few seconds...</p>
      </body>
    </html>
  `);
}).listen(PORT, () => {
  logger.info(`HTTP Keep-Alive & Web QR server listening on port ${PORT}`);
});

const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');

// ── WhatsApp Client Setup ─────────────────────────────────────────
async function startBot() {
  let authStrategy;
  if (config.mongoUri) {
    logger.info('Connecting to MongoDB for persistent RemoteAuth cloud session storage...');
    await mongoose.connect(config.mongoUri);
    logger.info('MongoDB connected successfully ✅');
    const store = new MongoStore({ mongoose });
    authStrategy = new RemoteAuth({
      clientId: 'wa-link-deleter-session',
      store: store,
      backupSyncIntervalMs: 60000
    });
  } else {
    logger.info('Using LocalAuth session storage (.wwebjs_auth)...');
    authStrategy = new LocalAuth();
  }

const client = new Client({
  authStrategy: authStrategy,
  puppeteer: {
    ...(process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-site-isolation-trials',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-features=Translate,BackForwardCache,MediaRouter,OptimizationHints',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding',
      '--metrics-recording-only',
      '--mute-audio',
      '--js-flags=--max-old-space-size=180',
    ],
  },
});

// ── Event: QR Code ────────────────────────────────────────────────
let hasLoggedQrNotice = false;

client.on('qr', async (qr) => {
  botStatus = 'QR_READY';
  try {
    latestQrDataUrl = await QRCode.toDataURL(qr);
  } catch (e) {}

  if (!hasLoggedQrNotice) {
    logger.info('QR Code ready — scan cleanly at app URL (https://wa-bot-rc6r.onrender.com)');
    hasLoggedQrNotice = true;
  }
});

// ── Event: Remote Session Saved ───────────────────────────────────
client.on('remote_session_saved', () => {
  logger.info('Cloud session successfully saved to MongoDB Atlas! ✅');
});

// ── Event: Ready ──────────────────────────────────────────────────
client.on('ready', async () => {
  botStatus = 'AUTHENTICATED';
  latestQrDataUrl = null; // Clear QR page when authenticated
  hasLoggedQrNotice = false;
  logger.info('Bot connected and ready ✅');
  await sendTelegramAlert('Bot connected and ready ✅');

  // Trigger initial MongoDB session backup 10 seconds after authentication
  if (client.authStrategy && typeof client.authStrategy.storeRemoteSession === 'function') {
    setTimeout(async () => {
      try {
        logger.info('Syncing session backup to MongoDB Atlas cloud storage...');
        await client.authStrategy.storeRemoteSession({ emit: true });
      } catch (syncErr) {
        logger.warn(`Initial cloud sync notice: ${syncErr.message}`);
      }
    }, 10000);
  }

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
});

// ── Event: Disconnected ───────────────────────────────────────────
client.on('disconnected', async (reason) => {
  logger.warn(`WhatsApp client disconnected: ${reason}`);
  await sendTelegramAlert(`⚠️ WhatsApp bot disconnected: ${reason}`);
  if (reason === 'LOGOUT' || String(reason).includes('LOGOUT')) {
    logger.warn('Session unlinked/logged out. Clearing .wwebjs_auth directory...');
    try {
      fs.rmSync('.wwebjs_auth', { recursive: true, force: true });
    } catch (e) {}
    process.exit(0);
  }
});

// ── Event: Message Created ────────────────────────────────────────
// Fires for ALL messages seen by the client, including the bot's own.
client.on('message_create', async (message) => {
  // Extract target group JID (chatId)
  // For incoming messages, message.from is group JID (ends with @g.us).
  // For self-sent messages (fromMe), message.from is user JID and message.to / message.id.remote is group JID.
  const chatId = message.id?.remote || (message.from && message.from.endsWith('@g.us') ? message.from : message.to);
  if (!chatId || !chatId.endsWith('@g.us')) return;

  // If specific target groups are specified, enforce the filter
  const targetGroupIds = config.targetGroupId && config.targetGroupId !== 'ALL' && config.targetGroupId !== '*'
    ? config.targetGroupId.split(',').map((s) => s.trim())
    : null; // null means monitor ALL groups

  if (targetGroupIds && !targetGroupIds.includes(chatId)) return;

  // Guard 2: Only act on text messages (ignore media-only messages with no caption)
  const body = message.body || '';

  if (isInstagramLinkOnly(body)) {
    logger.info('Instagram-only link detected — deleting...');
    await deleteMatchedMessage(message);
  }
});

// ── Start the client ──────────────────────────────────────────────
  logger.info('Initializing WhatsApp client...');
  client.initialize();
}

startBot().catch((err) => {
  logger.error(`Fatal startup error: ${err.message}`);
});
