'use strict';

// ──────────────────────────────────────────────────────────────────
// discover-groups.js — One-time helper to find your WhatsApp group ID
//
// HOW IT WORKS:
//   1. Run this script: node discover-groups.js
//   2. It connects using your saved session (no QR needed)
//   3. Send ANY message to your test group from your personal phone
//   4. The script prints the group name + ID
//   5. Copy the ID into .env as TARGET_GROUP_ID
//
// ──────────────────────────────────────────────────────────────────

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  WhatsApp Group ID Discovery Tool');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  },
});

const seenGroups = new Set();

client.on('qr', () => {
  console.log('❌ Session not found — run the main bot first to scan QR.');
  process.exit(1);
});

client.on('ready', () => {
  console.log('✅ Connected to WhatsApp!\n');
  console.log('👉 Now send ANY message to your "Bot Test Group" from your PERSONAL phone.');
  console.log('   (Just type "hi" — the content does not matter)');
  console.log('');
  console.log('   Waiting for a message...\n');

  // Auto-exit after 3 minutes if no message received
  setTimeout(() => {
    console.log('⏱  No message received in 3 minutes. Exiting.');
    process.exit(0);
  }, 3 * 60 * 1000);
});

// Capture group ID from any incoming message
client.on('message_create', (msg) => {
  const from = msg.from || '';

  // Only care about group messages (group IDs end in @g.us)
  if (!from.endsWith('@g.us')) return;

  // Avoid printing the same group twice
  if (seenGroups.has(from)) return;
  seenGroups.add(from);

  // Print the ID directly — msg.from already has everything we need
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✅ Group found!');
  console.log(`  ID   : ${from}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  Add this to your .env file:');
  console.log(`  TARGET_GROUP_ID=${from}`);
  console.log('');
  console.log('  Press Ctrl+C when done.');
  console.log('');
});

client.on('auth_failure', () => {
  console.error('❌ Auth failed. Delete .wwebjs_auth/ folder and re-scan QR.');
  process.exit(1);
});

client.initialize();
