# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# EduMitra sync API — multi-stage build.
#
#   build:  full install → tsc (tsconfig.build.json → dist/)
#   run:    production deps only, non-root user, health-checked
#
# Build:  docker build -t edumitra-server apps/server
# Run:    docker run -p 4600:4600 -e SYNC_SIGNING_SECRET=... edumitra-server
# ---------------------------------------------------------------------------

FROM node:22-alpine AS build
WORKDIR /app

# Install against the lockfile first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build


FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
# Runtime deps only (fastify, pg, zod, …). ioredis ships as an optional
# dependency and installs cleanly on Alpine; it is only used when REDIS_URL
# is set.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Runs as the unprivileged `node` user that ships with the image.
USER node
EXPOSE 4600

# Default port matches config.ts; override with -e PORT=… and the healthcheck
# follows via the shell expansion below.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-4600}/api/v1/health" >/dev/null || exit 1

CMD ["node", "dist/index.js"]
