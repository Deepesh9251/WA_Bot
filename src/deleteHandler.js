'use strict';

// ──────────────────────────────────────────────────────────────────
// deleteHandler.js — Attempts to delete a WhatsApp message for everyone
//
// Call deleteMatchedMessage(message) when a message has been
// confirmed as an Instagram-only link. This module handles the
// delete call and all error/alert logic around it.
// ──────────────────────────────────────────────────────────────────

const logger = require('./logger');
const { sendTelegramAlert } = require('./alerts/telegram');

const recentDeletedLogs = [];

function recordDeletedLog(url, senderName, groupName, sentTime) {
  recentDeletedLogs.unshift({
    timestamp: sentTime || new Date().toLocaleTimeString(),
    url: url || 'N/A',
    sender: senderName || 'Unknown',
    group: groupName || 'Group',
  });
  if (recentDeletedLogs.length > 20) recentDeletedLogs.pop();
}

/**
 * Deletes a WhatsApp message for everyone in the group.
 * Executes deletion FIRST (< 50ms fast path). ONLY resolves metadata and sends warning reply if deletion succeeds.
 *
 * @param {import('whatsapp-web.js').Message} message
 * @returns {Promise<void>}
 */
async function deleteMatchedMessage(message) {
  const msgSerializedId = typeof message.id === 'string' ? message.id : (message.id._serialized || message.id.id);
  const cleanUrl = message.body ? message.body.trim() : 'N/A';
  let deleteSuccess = false;

  // Step 1: Attempt deletion IMMEDIATELY (< 50ms fast path)
  try {
    await message.delete(true);
    deleteSuccess = true;
  } catch (err) {
    deleteSuccess = false;
    const errorDetails = err && err.message ? err.message : String(err);
    logger.error(`Failed to delete message: ${errorDetails}`);
    await sendTelegramAlert(
      `⚠️ Failed to delete an Instagram link.\n` +
      `Error: ${errorDetails}`
    );
  }

  // Step 2: ONLY if deletion succeeded, resolve metadata and send warning roast reply
  if (deleteSuccess) {
    let groupName = 'Group';
    try {
      const chat = await message.getChat();
      if (chat && chat.name) {
        groupName = chat.name;
      } else if (chat && chat.formattedTitle) {
        groupName = chat.formattedTitle;
      }
    } catch (e) {}

    // If groupName is purely digits (e.g. 120363...), default to 'Group'
    if (!groupName || /^\d+$/.test(groupName.trim())) {
      groupName = 'Group';
    }

    let senderName = 'Sender';
    if (message.fromMe) {
      senderName = 'Bot (You)';
    } else {
      senderName = message._data?.pushname || message._data?.notifyName || (message.author ? message.author.split('@')[0] : 'Sender');
      if (/^\d+$/.test(senderName)) {
        senderName = `+${senderName}`;
      }
    }

    const sentTime = message.timestamp ? new Date(message.timestamp * 1000).toLocaleTimeString() : new Date().toLocaleTimeString();

    logger.info(`Deleted Instagram link from "${senderName}" in group "${groupName}"`);
    recordDeletedLog(cleanUrl, senderName, groupName, sentTime);
    await sendWarningReply(message);
  }
}

const WARNING_MESSAGES = [
  '🗿 Bro, I quit Instagram to save my remaining braincells. Don\'t bring it to WhatsApp! Link incinerated 💥',
  '📜 Reel destroyed 🛑 If it\'s really that funny, type the transcript out line by line.',
  '🕵️‍♂️ Nice try, Reel Merchant! Your link has been banished to the shadow realm 🌌',
  '🤖 404: Instagram Addiction Not Found 🙅‍♂️ Reel vaporized. Tell me the joke in plain text!',
  '🌱 Touch grass my friend. Reel link successfully deleted 🌾',
  '🚨 Warning: Sending raw reels degrades admin friendship level by -10 points. Deleted!',
  '🧠 Save your screen time, save your soul. Reel link zapped ⚡',
  '🚫 I didn\'t leave Insta just to watch your reels on WhatsApp 🗿 Link deleted!',
];

/**
 * Sends a random warning message to the group.
 * Auto-deletes the warning message after 12 seconds to keep the group clean.
 *
 * @param {import('whatsapp-web.js').Message} message
 */
async function sendWarningReply(message) {
  try {
    const randomText = WARNING_MESSAGES[Math.floor(Math.random() * WARNING_MESSAGES.length)];
    const chatId = message.id?.remote || (message.from && message.from.endsWith('@g.us') ? message.from : message.to);

    const warningMsg = await message.client.sendMessage(
      chatId,
      randomText
    );

    // Clean up warning message after 12 seconds
    setTimeout(async () => {
      try {
        await warningMsg.delete(true);
      } catch (e) {
        // Ignore warning cleanup errors
      }
    }, 12000);
  } catch (err) {
    logger.warn(`Failed to send warning reply: ${err.message}`);
  }
}

module.exports = { deleteMatchedMessage, recentDeletedLogs };
