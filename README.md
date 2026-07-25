# WhatsApp Instagram-Link Auto-Deleter Bot

A Node.js bot that monitors a single WhatsApp group and **automatically deletes any message that is nothing but an Instagram Reel or Post link** (no caption, no emoji — pure link only).

Uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), sends alerts to Telegram, heartbeat to healthchecks.io, managed by pm2, deployed to Fly.io.

---

## Prerequisites

| Tool | Install |
|------|---------|
| Node.js ≥ 18 | https://nodejs.org |
| npm | Bundled with Node |
| pm2 | `npm install -g pm2` |
| flyctl | https://fly.io/docs/hands-on/install-flyctl/ |
| Docker | https://docs.docker.com/get-docker/ |
| A **burner/dedicated** WhatsApp account | Separate phone number — NOT your personal number |

---

## Local Setup

### 1. Clone & install dependencies

```bash
git clone <your-repo-url>
cd whatsapp-link-deleter
npm install
```

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Then open `.env` and fill in the values (see sections below for how to get each one).

---

## Telegram Bot Setup

You need a Telegram bot to receive alerts. This takes ~5 minutes.

1. Open Telegram → search **@BotFather** → send `/newbot`
2. Follow the prompts (choose any name and username)
3. BotFather gives you a **bot token** like `123456789:ABCdef...` — copy it as `TELEGRAM_BOT_TOKEN`
4. Open **@myidbot** in Telegram → send `/getid` → copy your numeric ID as `TELEGRAM_CHAT_ID`
5. Send `/start` to your new bot (required before it can message you)

---

## Healthchecks.io Setup

This gives you an email alert if the bot silently stops pinging (dead-man's switch).

1. Sign up free at https://healthchecks.io
2. Click **Add Check**
3. Set:
   - Name: `WA-Bot`
   - Period: **10 minutes**
   - Grace: **5 minutes**
4. Copy the ping URL (looks like `https://hc-ping.com/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) → set as `HEALTHCHECK_PING_URL`
5. Under Integrations, add your email for alerts when the check goes stale

---

## Two-Phase Group ID Discovery

WhatsApp group IDs are not visible in the app — you need to discover them programmatically.

### Phase 1 — Run without TARGET_GROUP_ID

Leave `TARGET_GROUP_ID=` blank in `.env`, then start the bot:

```bash
pm2 start ecosystem.config.js
pm2 logs wa-link-deleter
```

After scanning the QR code, the bot will print all groups it's in:

```
[INFO]  Group: "My Test Group" | ID: 1234567890-1234567890@g.us
[INFO]  Group: "Family Chat" | ID: 9876543210@g.us
```

Then it exits automatically.

### Phase 2 — Set the group ID and restart

Copy the correct group ID, add it to `.env`:

```
TARGET_GROUP_ID=1234567890-1234567890@g.us
```

Restart the bot:

```bash
pm2 restart wa-link-deleter
pm2 logs wa-link-deleter
```

The bot will now connect and start monitoring that group.

---

## Running Locally with pm2

### First run (QR scan needed)

```bash
pm2 start ecosystem.config.js
pm2 logs wa-link-deleter
```

You'll see a QR code in the logs. On the **bot's burner WhatsApp account**:
- WhatsApp → **Linked Devices** → **Link a Device** → scan the QR

You should receive a Telegram alert: `[WA-Bot] Bot connected and ready ✅`

### Subsequent runs (no QR needed)

```bash
pm2 restart wa-link-deleter
```

The session is saved in `.wwebjs_auth/` — no re-scan needed.

### Useful pm2 commands

```bash
pm2 logs wa-link-deleter   # Stream logs
pm2 status                  # Check process status
pm2 stop wa-link-deleter    # Stop the bot
pm2 delete wa-link-deleter  # Remove from pm2
pm2 save                    # Save pm2 process list (for auto-start on reboot)
pm2 startup                 # Generate startup script
```

---

## Manual Test Plan

Run these tests after the bot is connected and `TARGET_GROUP_ID` is set.

You need the group to have:
- Bot account as **admin**
- Your personal WhatsApp account as a member

From your **personal** WhatsApp, send these to the target group:

| # | Message to Send | Expected Result |
|---|-----------------|-----------------|
| 1 | `https://www.instagram.com/reel/ABC123/` | ✅ Deleted within ~3 seconds |
| 2 | `Check this: https://www.instagram.com/reel/ABC123/` | ❌ Not deleted (has caption) |
| 3 | `https://www.instagram.com/reel/ABC123/ 🔥` | ❌ Not deleted (emoji = extra text) |
| 4 | `https://www.youtube.com/watch?v=dQw4w9WgXcQ` | ❌ Not deleted (not Instagram) |
| 5 | `https://www.instagram.com/username/` | ❌ Not deleted (profile, not reel/post) |

---

## Fly.io Deployment

### One-time setup

```bash
# 1. Login to Fly.io
flyctl auth login

# 2. Launch the app (creates the app on Fly.io, does not deploy yet)
flyctl launch --no-deploy

# 3. Create a persistent volume for the WhatsApp session
#    (1 GB is more than enough; session is ~1 MB)
flyctl volumes create wa_session --size 1 --region bom

# 4. Set all secrets (env vars) — these are encrypted by Fly.io
flyctl secrets set \
  TELEGRAM_BOT_TOKEN="your_bot_token" \
  TELEGRAM_CHAT_ID="your_chat_id" \
  HEALTHCHECK_PING_URL="https://hc-ping.com/your-uuid" \
  TARGET_GROUP_ID=""
```

### First deploy + QR scan

```bash
# 5. Deploy
flyctl deploy

# 6. Watch logs for the QR code
flyctl logs

# Scan the QR with the bot's burner WhatsApp account
# Wait for: "[INFO] Bot connected and ready ✅"
# And the Telegram alert confirming connection

# 7. Once connected, set the group ID and redeploy
flyctl secrets set TARGET_GROUP_ID="your-group-id@g.us"
flyctl deploy
```

### Redeploying (session survives)

```bash
flyctl deploy
flyctl logs
# Expected: bot reconnects WITHOUT a new QR scan
# (the .wwebjs_auth/ volume mount preserves the session)
```

### Checking app status

```bash
flyctl status          # VM health
flyctl logs            # Stream logs
flyctl ssh console     # SSH into the VM (for debugging)
```

---

## Architecture Overview

```
src/
├── index.js           # Entry point — WhatsApp client + event handlers
├── config.js          # All env var reads, validation on startup
├── linkDetector.js    # Pure function: is this message an IG-only link?
├── deleteHandler.js   # Attempts delete-for-everyone, alerts on failure
├── logger.js          # Timestamped console logger
└── alerts/
    ├── telegram.js    # sendTelegramAlert(message) — never throws
    └── healthcheck.js # startHeartbeat() — pings healthchecks.io every 5 min
```

---

## Troubleshooting

### Bot shows QR every restart (session not persisting)

- **Local**: Check that `.wwebjs_auth/` exists in the project root and is NOT in `.gitignore` being deleted.
- **Fly.io**: Confirm the volume is mounted: `flyctl volumes list`. Check that the mount path in `fly.toml` matches `/app/.wwebjs_auth`.

### Bot connects but doesn't delete messages

1. Confirm `TARGET_GROUP_ID` matches exactly (including `@g.us` suffix).
2. Confirm the bot's burner account is **admin** in the group.
3. Check `pm2 logs` / `flyctl logs` for `[INFO] Message in target group...` entries.
4. Send a pure bare link (no caption at all) for test #1.

### Puppeteer/Chrome crashes on Fly.io

- The `--no-sandbox` and `--disable-dev-shm-usage` flags in `index.js` are required for containers.
- If still crashing, try increasing memory to 1024 MB in `fly.toml`.

### WhatsApp session invalid (auth_failure)

The session token was revoked (WhatsApp logged out the linked device).

```bash
# Local: delete session and restart (new QR scan)
rm -rf .wwebjs_auth/
pm2 restart wa-link-deleter

# Fly.io: delete the volume contents and redeploy
flyctl ssh console
rm -rf /app/.wwebjs_auth/*
exit
flyctl deploy
# Watch logs for QR code, scan again
```

### WhatsApp Web UI popup ("A fresh look for WhatsApp Web")

This is a known edge case. The bot may get stuck if WhatsApp shows a UI popup that Puppeteer doesn't auto-dismiss. The healthchecks.io alert will notify you when the heartbeat stops. Manual intervention: restart the bot.

---

## Security Notes

- Never commit `.env` — it's in `.gitignore`.
- Never commit `.wwebjs_auth/` — it contains auth tokens equivalent to a logged-in WhatsApp session.
- The bot account should be a **dedicated burner number** — not your personal WhatsApp.
- Fly.io secrets are encrypted at rest and injected at runtime — safe for production tokens.
