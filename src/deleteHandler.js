'use strict';

// ──────────────────────────────────────────────────────────────────
// deleteHandler.js — Attempts to delete a WhatsApp message for everyone
//
// Call deleteMatchedMessage(message) when a message has been
// confirmed as an Instagram-only link. This module handles the
// delete call and all error/alert logic around it.
//
// NOTE on delete-for-everyone:
//   message.delete(true) deletes for everyone in the group.
//   This only works if:
//     1. The bot account is an ADMIN of the group.
//     2. The message was sent recently (WhatsApp enforces a time window).
//   If either condition is not met, the delete call throws — which
//   we catch, log, and alert on.
// ──────────────────────────────────────────────────────────────────

const logger = require('./logger');
const { sendTelegramAlert } = require('./alerts/telegram');

const recentDeletedLogs = [];

function recordDeletedLog(url, sender, group) {
  recentDeletedLogs.unshift({
    timestamp: new Date().toLocaleTimeString(),
    url: url || 'N/A',
    sender: sender || 'Unknown',
    group: group || 'Unknown',
  });
  if (recentDeletedLogs.length > 20) recentDeletedLogs.pop();
}

/**
 * Deletes a WhatsApp message for everyone in the group.
 *
 * @param {import('whatsapp-web.js').Message} message
 * @returns {Promise<void>}
 */
async function deleteMatchedMessage(message) {
  const msgSerializedId = typeof message.id === 'string' ? message.id : (message.id._serialized || message.id.id);

  try {
    const res = await message.client.pupPage.evaluate(async (targetId) => {
      const Collections = window.require('WAWebCollections');
      const MsgStore = Collections.Msg;
      const ChatStore = Collections.Chat;
      const { Cmd } = window.require('WAWebCmd');

      let msg = MsgStore.get(targetId);
      if (!msg && MsgStore._models) {
        msg = MsgStore._models.find(m => m.id._serialized === targetId || m.id.id === targetId || m.id === targetId);
      }
      if (!msg && MsgStore.getMessagesById) {
        try {
          const res = await MsgStore.getMessagesById([targetId]);
          msg = res?.messages?.[0];
        } catch (e) {}
      }

      if (!msg) return { success: false, error: 'Message not found in MsgStore' };

      let chat = ChatStore.get(msg.id.remote);
      if (!chat && ChatStore.find) {
        chat = await ChatStore.find(msg.id.remote);
      }

      if (!chat) return { success: false, error: 'Chat not found' };

      if (Cmd && Cmd.sendRevokeMsgs) {
        try {
          await Cmd.sendRevokeMsgs(chat, { list: [msg], type: 'message' }, { clearMedia: true, type: 'Admin' });
        } catch (e1) {
          await Cmd.sendRevokeMsgs(chat, [msg], { clearMedia: true, type: 'Admin' });
        }
        return { success: true };
      }

      return { success: false, error: 'Cmd.sendRevokeMsgs unavailable' };
    }, msgSerializedId);

    if (res.success) {
      const cleanUrl = message.body ? message.body.trim() : 'N/A';
      recordDeletedLog(cleanUrl, message.author || message.from, message.from);
      logger.info(`Deleted Instagram link [${cleanUrl}] from ${message.author || message.from} in group (${message.from})`);
      await sendWarningReply(message);
      return;
    }
  } catch (err) {
    logger.warn(`Direct revoke attempt failed: ${err.message}. Trying standard delete...`);
  }

  // Fallback to standard delete call
  try {
    await message.delete(true);
    const cleanUrl = message.body ? message.body.trim() : 'N/A';
    recordDeletedLog(cleanUrl, message.author || message.from, message.from);
    logger.info(`Deleted Instagram link via standard fallback [${cleanUrl}] from ${message.author || message.from}`);
    await sendWarningReply(message);
  } catch (err) {
    logger.error(`Failed to delete message from ${message.author || message.from}:`, err.message);
    await sendTelegramAlert(
      `⚠️ Failed to delete an Instagram link.\n` +
      `Sender: ${message.author || message.from}\n` +
      `Group: ${message.from}\n` +
      `Error: ${err.message}`
    );
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

    const warningMsg = await message.client.sendMessage(
      message.from,
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
