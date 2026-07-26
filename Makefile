# ──────────────────────────────────────────────────────────────────
# Makefile — Shorthand commands for WhatsApp Link Deleter Bot
# ──────────────────────────────────────────────────────────────────

.PHONY: start stop restart status logs discover test dev stage help

# Ensure npm global binaries (pm2) are on PATH
export PATH := $(HOME)/.npm-global/bin:$(PATH)

help:
	@echo ""
	@echo " WhatsApp Link Deleter Bot — Available Commands:"
	@echo " ────────────────────────────────────────────────"
	@echo "  make dev       - Run bot locally in foreground for testing"
	@echo "  make stage     - Run 512MB Docker container staging (exact Render match)"
	@echo "  make start     - Start bot under pm2"
	@echo "  make stop      - Stop bot"
	@echo "  make restart   - Cleanly restart bot (clears lock files)"
	@echo "  make status    - Show pm2 process status"
	@echo "  make logs      - Stream live bot logs"
	@echo "  make discover  - Run group discovery tool"
	@echo "  make test      - Run link detector test suite"
	@echo ""

dev:
	@echo "🐳 Building & running Dev Container locally on port 3000..."
	sudo docker build -t wa-bot:dev .
	sudo docker run --rm -it --name wa-bot-dev -p 3000:3000 -e APP_ENV=DEV -e NODE_ENV=development -e PORT=3000 --env-file .env wa-bot:dev

stage:
	@echo "🐳 Building & running Render 512MB Staging Container locally..."
	sudo docker build -t wa-bot:staging .
	sudo docker run --rm -it --name wa-bot-stage --memory=512m -p 10000:10000 -e PORT=10000 -e APP_ENV=STAGE -e NODE_ENV=staging --env-file .env wa-bot:staging

start:
	pm2 start ecosystem.config.js

stop:
	-pm2 stop wa-link-deleter 2>/dev/null
	-pkill -9 -f chromium 2>/dev/null
	-pkill -9 -f chrome 2>/dev/null
	-fuser -k 3000/tcp 2>/dev/null
	-find .wwebjs_auth -name "Singleton*" -delete 2>/dev/null

restart:
	-pm2 stop wa-link-deleter 2>/dev/null
	-pkill -9 -f chromium 2>/dev/null
	-pkill -9 -f chrome 2>/dev/null
	-fuser -k 3000/tcp 2>/dev/null
	-find .wwebjs_auth -name "Singleton*" -delete 2>/dev/null
	pm2 start ecosystem.config.js
	@echo "Bot cleanly restarted!"

status:
	pm2 status

logs:
	pm2 logs wa-link-deleter

discover:
	-pm2 stop wa-link-deleter 2>/dev/null
	node discover-groups.js

test:
	@node -e "const { isInstagramLinkOnly } = require('./src/linkDetector'); const cases = [['https://www.instagram.com/reel/ABC123/', true], ['https://instagram.com/p/XYZ789', true], ['Check this https://www.instagram.com/reel/ABC/', false], ['https://youtube.com/watch?v=123', false]]; let p=0; for(const [i,e] of cases){ const r=isInstagramLinkOnly(i); const ok=r===e; console.log(ok?'✅ PASS':'❌ FAIL', i, '->', r); if(ok)p++; } console.log(p+'/'+cases.length+' passed');"
