# Build Prompt: WhatsApp Instagram-Link Auto-Deleter Bot

Copy everything below into your AI coding agent (Claude Code / Antigravity / etc.) as the task prompt.

---

## PROJECT OVERVIEW

Build a Node.js bot that connects to WhatsApp using a **dedicated/burner WhatsApp account** (not the owner's personal account), joins one specific WhatsApp group where it has been made an **admin**, monitors all incoming messages in that group, and **auto-deletes-for-everyone** any message whose entire text content is *only* an Instagram Reel or Post link (no additional caption text).

The bot must also send health/error alerts to the owner via Telegram, and expose a heartbeat endpoint monitored by healthchecks.io so silent failures are detected.

This is a personal-use, single-group, low-traffic bot. Prioritize **simplicity, robustness, and clear error visibility** over features, abstraction, or scalability. Do not over-engineer. No database is needed. No web UI is needed.

---

## TECH STACK (fixed — do not substitute)

- **Runtime**: Node.js (LTS version, 20.x or later)
- **WhatsApp automation library**: `whatsapp-web.js` (uses Puppeteer under the hood)
- **Session persistence**: `LocalAuth` strategy from `whatsapp-web.js` (saves session to local disk so QR scan is only needed once)
- **Process manager**: `pm2` (for auto-restart on crash, on both local testing and the deployed VM)
- **Alerting #1**: Telegram Bot API (via `node-telegram-bot-api` npm package or raw `fetch` calls to Telegram's HTTP API — agent's choice, prefer raw fetch to minimize dependencies)
- **Alerting #2**: healthchecks.io — a simple `fetch` GET request to a healthchecks.io ping URL, sent on an interval (dead-man's-switch pattern)
- **Deployment target**: Fly.io free tier (persistent VM, not serverless)
- **Environment/config management**: `.env` file with `dotenv` package — never hardcode secrets in source

---

## FOLDER STRUCTURE (agent may adjust naming slightly but must keep this general shape)

```
whatsapp-link-deleter/
├── src/
│   ├── index.js              # Entry point — initializes client, wires up event handlers
│   ├── config.js             # Loads and validates all env vars in one place
│   ├── linkDetector.js        # Pure function(s): given message text, return true/false "is Instagram-reel-or-post-only link"
│   ├── deleteHandler.js       # Given a matched message object, attempts delete-for-everyone with error handling
│   ├── alerts/
│   │   ├── telegram.js        # sendTelegramAlert(message: string) — wraps Telegram HTTP API call
│   │   └── healthcheck.js     # startHeartbeat() — sets up interval ping to healthchecks.io
│   └── logger.js             # Simple timestamped console logger (no external logging lib needed)
├── .env.example               # Template showing all required env vars with placeholder values, committed to repo
├── .env                        # Actual secrets — MUST be in .gitignore, never committed
├── .gitignore                  # Must exclude: .env, node_modules, .wwebjs_auth/, .wwebjs_cache/
├── package.json
├── fly.toml                    # Fly.io deployment config
├── Dockerfile                  # Required for Fly.io deployment with Puppeteer/Chromium dependencies
├── ecosystem.config.js         # pm2 config for local/VM process management
└── README.md                   # Setup instructions, deployment steps, how to re-auth if session is lost
```

---

## DETAILED FUNCTIONAL REQUIREMENTS

### 1. WhatsApp Client Initialization (`src/index.js`)
- Initialize `whatsapp-web.js` `Client` with `LocalAuth` strategy (session stored in `.wwebjs_auth/` directory, which must be excluded from git and persisted on the Fly.io volume between deploys/restarts).
- On `qr` event: print the QR code to the console/logs using the `qrcode-terminal` npm package (so it can be scanned during first-time setup by viewing server logs), AND send a Telegram alert saying "QR code ready — check logs to scan" (cannot send the QR image itself over Telegram at this stage since the bot isn't authenticated yet; text alert is enough).
- On `ready` event: log "Bot connected and ready" and send a Telegram alert confirming successful connection.
- On `disconnected` event: log the reason, send a Telegram alert with the disconnect reason, and let `pm2` handle process restart (do not implement manual reconnect logic — rely on process manager restart + WhatsApp session persistence).
- On `auth_failure` event: log the failure and send a Telegram alert — this means the session is invalid and manual QR re-scan is required.

### 2. Target Group Identification
- The bot must only act on messages from **one specific group**, identified by its WhatsApp group ID (a string like `xxxxxxxxxx@g.us`).
- This group ID must be read from an environment variable `TARGET_GROUP_ID` — do not hardcode it.
- Provide a one-time helper mode: if `TARGET_GROUP_ID` is not set in `.env`, the bot should instead log **all group names and their IDs** that the bot account is a member of, on startup, then exit. This lets the owner run the bot once after joining the group to discover the correct ID, then set it in `.env` and restart normally. Document this two-step setup clearly in the README.

### 3. Message Filtering Logic (`src/linkDetector.js`)
- Export a pure function `isInstagramLinkOnly(messageBody: string): boolean`.
- Logic:
  1. Trim the message body of leading/trailing whitespace.
  2. Check if the trimmed body, in its entirety, matches a URL pattern for an Instagram Reel or Post. Use this regex as the base (agent should test and refine, but must anchor to full-string match, not "contains"):
     ```
     ^https?:\/\/(www\.)?instagram\.com\/(reel|reels|p)\/[A-Za-z0-9_\-]+\/?(\?[^\s]*)?$
     ```
  3. Return `true` only if the ENTIRE trimmed message matches this pattern (i.e., the message is nothing but the link, optionally with a trailing slash or query string). If there is ANY additional text before or after the link (a caption, emoji, "check this out", etc.), return `false`.
  4. Write at least 8 unit-test-style example inputs directly in the file or a comment block showing expected true/false outcomes, covering: bare link, link with query params, link with caption before, link with caption after, link with emoji only, non-Instagram link, Instagram profile link (not reel/post — should be false), forwarded message with extra whitespace.
- Do NOT use a third-party link-detection library — a single well-tested regex is sufficient and easier to reason about.

### 4. Message Event Handler (in `src/index.js`, using `deleteHandler.js`)
- Listen to the `message_create` event (not just `message`) so the bot also sees messages if needed for debugging — but only act on messages where `message.from === TARGET_GROUP_ID` and `message.fromMe === false` (never try to delete the bot's own messages).
- For every qualifying message, pass `message.body` to `isInstagramLinkOnly()`.
- If `true`, call the deletion logic in `deleteHandler.js`.

### 5. Deletion Logic (`src/deleteHandler.js`)
- Export `async function deleteMatchedMessage(message)`.
- Call `message.delete(true)` (the `true` argument means delete-for-everyone).
- Wrap in try/catch:
  - On success: log which message was deleted (log the sender's ID and a timestamp — do NOT log the full message content beyond confirming it matched, to avoid unnecessary data in logs).
  - On failure (e.g., delete window expired, permission error): log the error AND send a Telegram alert including the error message and a note that manual deletion may be required, since this is a signal something is wrong (lost admin rights, WhatsApp API change, etc.).

### 6. Telegram Alerting (`src/alerts/telegram.js`)
- Export `async function sendTelegramAlert(message: string)`.
- Use Telegram Bot API via `https://api.telegram.org/bot<TOKEN>/sendMessage` with a POST request (native `fetch`, Node 20+ has this built in — no extra HTTP library needed).
- Read `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` from environment variables.
- All alerts should be prefixed with a consistent tag like `[WA-Bot]` so they're easy to filter in a busy Telegram chat.
- This function must never throw uncaught — wrap its own internal fetch in try/catch and just console.log if the alert itself fails to send (don't crash the bot because an alert failed).
- Document in README: how to create a Telegram bot via @BotFather, and how to get your own numeric chat ID (e.g., via @myidbot or the getUpdates API call).

### 7. Healthchecks.io Heartbeat (`src/alerts/healthcheck.js`)
- Export `function startHeartbeat()`.
- Read `HEALTHCHECK_PING_URL` from environment variables (the unique ping URL provided by healthchecks.io for a check the owner creates manually on healthchecks.io's dashboard).
- On an interval (every 5 minutes — use `setInterval`), send a simple GET request to that URL via `fetch`. No payload needed.
- Wrap in try/catch, log failures, but never crash the process over a failed heartbeat ping.
- Call `startHeartbeat()` once, only after the WhatsApp client's `ready` event fires (so the heartbeat represents "bot is actually connected," not just "process is running").
- Document in README: how to create a check on healthchecks.io (free tier), set its expected period to ~10 minutes (double the ping interval, to allow for one missed ping before alerting), and configure an email alert on healthchecks.io's side when the check goes stale.

### 8. Configuration (`src/config.js`)
- Centralize all `process.env` reads here, export a single config object.
- Required env vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `HEALTHCHECK_PING_URL`, `TARGET_GROUP_ID` (optional at first run, see section 2).
- On startup, validate that all REQUIRED vars (Telegram + healthcheck ones; `TARGET_GROUP_ID` is optional on first run only) are present. If missing, log a clear error listing exactly which var is missing and exit with a non-zero code — do not let the bot run in a half-configured state.

### 9. Logging (`src/logger.js`)
- Simple wrapper around `console.log`/`console.error` that prefixes every line with an ISO timestamp and a level tag (`[INFO]`, `[ERROR]`, `[WARN]`).
- No external logging library needed (no winston/pino) — this is intentionally minimal.

---

## DEPLOYMENT REQUIREMENTS (Fly.io)

- Provide a `Dockerfile` that:
  - Uses a Node base image.
  - Installs Chromium and all system dependencies Puppeteer needs to run headless Chrome in a container (this is the most common source of Fly.io deployment failures for Puppeteer projects — agent must research and include the correct apt packages for the Node base image chosen, e.g. `chromium`, fonts, `libnss3`, etc.).
  - Sets `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` and points `PUPPETEER_EXECUTABLE_PATH` to the system-installed Chromium, rather than letting Puppeteer download its own copy (saves image size and avoids download failures in restricted network environments).
- Provide a `fly.toml` configured for:
  - A single persistent VM (not autoscaling to zero — this must stay running continuously).
  - A **mounted persistent volume** for the `.wwebjs_auth/` directory, so the WhatsApp session survives redeploys and VM restarts (critical — without this, every deploy would require a fresh QR scan).
- Document exact `flyctl` CLI commands in the README for: initial launch, volume creation, setting secrets (env vars) via `flyctl secrets set`, and redeploying.

---

## SETUP / AUTH FLOW (must be documented step-by-step in README)

1. Register a new WhatsApp account on a separate/burner phone number (this is the "bot account," distinct from the owner's personal WhatsApp).
2. Add that bot account's number to the target WhatsApp group.
3. Make the bot account an **admin** of the group (required for delete-for-everyone permissions on others' messages).
4. Deploy the bot to Fly.io (or run locally first for testing).
5. On first run, scan the printed QR code using the **bot account's** phone (WhatsApp app → Linked Devices → Link a Device) — not the owner's personal phone.
6. Confirm `ready` event fires and a Telegram alert is received.
7. If `TARGET_GROUP_ID` wasn't set yet, note the group ID logged on startup, add it to `.env` / Fly secrets, and restart.
8. Send a test message in the group that is ONLY an Instagram reel link, from a non-admin test account, and confirm it gets deleted within a few seconds.
9. Send a test message with a reel link PLUS a caption, and confirm it does NOT get deleted (false-positive check).

---

## EXPLICIT NON-GOALS (do not build these — keep scope tight)

- No support for multiple groups — single group only, via one hardcoded env var.
- No web dashboard or UI of any kind.
- No database — no persistence beyond the WhatsApp session folder itself.
- No handling of edited messages, only newly created ones.
- No attempt to auto-dismiss WhatsApp Web UI popups (e.g., "A fresh look for WhatsApp Web") — if the bot gets stuck on one, that's what the healthcheck alert is for; manual intervention is acceptable for this edge case.
- No rate-limiting or bulk-message-sending logic — this bot never sends messages to the group itself except via alerts to the owner's separate Telegram, so WhatsApp ban risk from spam-sending patterns does not apply here.

---

## DELIVERABLES CHECKLIST (agent should confirm each before considering task complete)

- [ ] All files in the folder structure above exist and contain working code
- [ ] `.env.example` lists every required variable with a placeholder and a one-line comment explaining each
- [ ] `.gitignore` correctly excludes secrets, node_modules, and session/cache folders
- [ ] README includes: prerequisites, local setup steps, the two-phase group-ID discovery flow, Telegram bot creation steps, healthchecks.io setup steps, Fly.io deployment steps with exact CLI commands, and the manual test plan from the "Setup/Auth Flow" section above
- [ ] Regex-based link detector has inline documented test cases as described in section 3
- [ ] Bot runs locally via `pm2 start ecosystem.config.js` and reconnects after a manual `pm2 restart` without requiring re-scan (proves session persistence works before even touching Fly.io)
- [ ] Bot deploys to Fly.io successfully and survives a `flyctl deploy` (redeploy) without losing its WhatsApp session (proves the volume mount works)

---

## STYLE / CODE QUALITY NOTES

- Prefer plain, readable JavaScript (CommonJS `require`, not ES modules, for simplicity and compatibility with `whatsapp-web.js` examples) unless there's a strong reason to do otherwise.
- No TypeScript — this is intentionally kept simple.
- Every file should be short and single-purpose, matching the folder structure above — do not collapse everything into one giant `index.js`.
- Comment the regex and the delete-permission logic clearly, since these are the two places future-you will need to debug first.