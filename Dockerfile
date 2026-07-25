# ──────────────────────────────────────────────────────────────────
# Dockerfile for WhatsApp Link Deleter Bot
#
# Uses system-installed Chromium instead of Puppeteer's bundled copy.
# This avoids a ~300 MB download and works better in restricted envs.
#
# Key env vars set here (Fly secrets override at runtime):
#   PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
#   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# ──────────────────────────────────────────────────────────────────

FROM node:18-slim

# Install Chromium + all system libs Puppeteer needs to run headless Chrome.
# These are the correct packages for the Debian-slim base image.
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to skip downloading its own Chrome and use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create app directory
WORKDIR /app

# Copy package files first (layer caching — only re-runs npm ci when deps change)
COPY package.json package-lock.json* ./

# Install production deps only (no devDependencies)
RUN npm ci --omit=dev

# Copy source code
COPY src/ ./src/

# The .wwebjs_auth/ session folder is mounted as a volume in fly.toml
# so it persists across deploys — do NOT copy it into the image.

# Run as a non-root user for security
RUN groupadd -r botuser && useradd -r -g botuser botuser
USER botuser

CMD ["node", "src/index.js"]
