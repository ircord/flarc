# Build on Linux amd64. Bun installs and produces the immutable workerd bundle.
FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
RUN bun run build:tools

FROM oven/bun:1.4.4 AS production-dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 TCP_HOST=0.0.0.0 PORT=8788 TCP_PORT=6667 STATE_DIR=/data
RUN mkdir -p /data && chown node:node /data
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/.output/server ./.output/server
COPY --from=build --chown=node:node /app/.output/tools ./.output/tools
COPY --from=build --chown=node:node /app/scripts/start-miniflare.mjs /app/scripts/allowlist-config.mjs /app/scripts/safe-outbound.mjs ./scripts/
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/allowlist.yaml ./allowlist.yaml
USER node
EXPOSE 8788 6667
CMD ["node", "scripts/start-miniflare.mjs"]
