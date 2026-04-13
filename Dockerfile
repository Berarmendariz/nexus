# Nexus Backend — Node.js + Python (MiroFish Flask subprocess)
FROM node:22-slim AS base

# Install Python + pip + venv
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node deps
COPY package.json package-lock.json ./
RUN npm ci --production

# Install Python deps in venv
COPY mirofish-backend/requirements.txt ./mirofish-backend/requirements.txt
RUN python3 -m venv .mirofish-venv \
    && .mirofish-venv/bin/pip install --no-cache-dir -r mirofish-backend/requirements.txt

# Copy app source
COPY server.js mirofish-manager.js ./
COPY mirofish-backend/ ./mirofish-backend/

# Railway injects PORT env var automatically
ENV NODE_ENV=production
EXPOSE 3002

CMD ["node", "server.js"]
