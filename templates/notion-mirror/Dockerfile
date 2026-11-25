# Optional sync daemon: keeps KV current from Notion (sync/daemon.ts).
# Run it as a long-lived container (e.g. a Coolify Dockerfile application) with a
# persistent volume on /data. See README § "Sync daemon".
FROM oven/bun:1.4.4-debian
WORKDIR /app
COPY package.json bun.lock* ./
RUN if [ -f bun.lock ]; then bun install --frozen-lockfile --production; else bun install --production; fi
COPY src ./src
COPY scripts ./scripts
COPY sync ./sync
COPY wrangler.toml tsconfig.json ./
ENV STATE_DIR=/data/state \
    WARM_CACHE_ROOT=/data/cache \
    NODE_ENV=production
VOLUME ["/data"]
HEALTHCHECK --interval=5m --timeout=30s --start-period=15m --retries=2 CMD ["bun", "run", "sync/healthcheck.ts"]
CMD ["bun", "run", "sync/daemon.ts"]
