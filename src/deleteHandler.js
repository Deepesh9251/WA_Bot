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
 * Verifies whether a message has actually been revoked in WhatsApp Web DOM.
 * @param {import('whatsapp-web.js').Message} message
 * @returns {Promise<boolean>}
 */
async function verifyMessageRevoked(message) {
  try {
    const isRevoked = await message.client.pupPage.evaluate((msgObj) => {
      try {
        const collections = window.require && window.require('WAWebCollections');
        if (!collections || !collections.Msg) return false;
        let targetId = msgObj._serialized || msgObj.id;
        let msg = collections.Msg.get(targetId);
        if (!msg && collections.Msg._models) {
          msg = collections.Msg._models.find(m => m.id._serialized === targetId || m.id.id === msgObj.id);
        }
        if (msg) {
          return msg.type === 'revoked' || msg.isRevoked === true || Boolean(msg.isRevoked);
        }
      } catch (e) {}
      return false;
    }, message.id);
    return Boolean(isRevoked);
  } catch (e) {
    return false;
  }
}

/**
 * Handles deletion of a detected Instagram link message.
 *
 * @param {import('whatsapp-web.js').Message} message
 * @returns {Promise<void>}
 */
async function deleteMatchedMessage(message) {
  const msgSerializedId = typeof message.id === 'string' ? message.id : (message.id._serialized || message.id.id);
  const cleanUrl = message.body ? message.body.trim() : 'N/A';
  let deleteSuccess = false;

  // Step 1: Attempt standard deletion (< 50ms fast path)
  try {
    await message.delete(true);
    deleteSuccess = true;
  } catch (err) {
    // Step 2: Fallback to direct Cmd.sendRevokeMsgs call with WAWeb 2.3000+ support
    try {
      await message.client.pupPage.evaluate(async (msgObj) => {
        try {
          const collections = window.require && window.require('WAWebCollections');
          if (!collections) return false;
          
          let targetId = msgObj._serialized || msgObj.id;
          let msg = collections.Msg ? collections.Msg.get(targetId) : null;
          if (!msg && collections.Msg && collections.Msg._models) {
            msg = collections.Msg._models.find(m => m.id._serialized === targetId || m.id.id === msgObj.id);
          }
          
          if (!msg && collections.Chat) {
            const chatJid = msgObj.remote || msgObj.from;
            let chatObj = collections.Chat.get(chatJid);
            if (chatObj && chatObj.msgs && chatObj.msgs._models) {
              msg = chatObj.msgs._models.find(m => m.id.id === msgObj.id || m.id._serialized === targetId);
            }
          }

          if (msg) {
            let chat = collections.Chat ? collections.Chat.get(msg.id.remote) : null;
            if (!chat && collections.Chat && collections.Chat.find) {
              chat = await collections.Chat.find(msg.id.remote);
            }
            const cmdObj = window.require && window.require('WAWebCmd');
            const Cmd = cmdObj ? (cmdObj.Cmd || cmdObj) : null;
            if (chat && Cmd && Cmd.sendRevokeMsgs) {
              const isNewVersion = window.WWebJS && window.WWebJS.compareWwebVersions && window.WWebJS.compareWwebVersions(window.Debug.VERSION, '>=', '2.3000.0');
              if (isNewVersion) {
                await Cmd.sendRevokeMsgs(chat, { list: [msg], type: 'message' }, { clearMedia: true, type: 'Admin' });
              } else {
                await Cmd.sendRevokeMsgs(chat, [msg], { clearMedia: true, type: 'Admin' });
              }
              return true;
            }
          }
        } catch (e) {}
        return false;
      }, message.id);

      // Brief 100ms pause for WebSocket revocation frame to process
      await new Promise((r) => setTimeout(r, 100));
      deleteSuccess = await verifyMessageRevoked(message);
    } catch (fallbackErr) {
      deleteSuccess = false;
    }
  }

  if (!deleteSuccess) {
    logger.error(`Failed to delete message: Message revocation unconfirmed in WhatsApp Web`);
    await sendTelegramAlert(
      `⚠️ Failed to delete an Instagram link.\n` +
      `Error: Message revocation unconfirmed`
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
