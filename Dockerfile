# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# EduMitra — single-image deployment: Fastify API + built PWA, same origin.
#
# The server process serves apps/client/dist at "/", so one container is the
# whole web app (relative /api/v1 works, no CORS, one health check).
#
# Local:   docker build -t edumitra . && docker run -p 4600:4600 -e SYNC_SIGNING_SECRET=<16+> edumitra
# Render:  built via render.yaml — Render translates every service env var
#          into a build arg of the same name, which is how the client bundle
#          gets the exact SYNC_SIGNING_SECRET the server verifies with.
# ---------------------------------------------------------------------------

# ---- Stage 1: PWA (React + Vite) -----------------------------------------
FROM node:22-alpine AS client-build
WORKDIR /repo/apps/client
COPY apps/client/package.json apps/client/package-lock.json ./
RUN npm ci
COPY apps/client/ ./
# Empty/absent arg falls back to the dev default so a plain `docker build`
# still produces a working image for local use.
ARG SYNC_SIGNING_SECRET
RUN VITE_SYNC_SIGNING_SECRET="${SYNC_SIGNING_SECRET:-dev-only-insecure-shared-secret}" npm run build


# ---- Stage 2: API (Fastify + tsc) ----------------------------------------
FROM node:22-alpine AS server-build
WORKDIR /repo/apps/server
COPY apps/server/package.json apps/server/package-lock.json ./
RUN npm ci
COPY apps/server/tsconfig.json apps/server/tsconfig.build.json ./
COPY apps/server/src ./src
RUN npm run build


# ---- Stage 3: runtime -----------------------------------------------------
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /repo

# Production dependencies only (fastify, pg, zod, optional ioredis).
COPY apps/server/package.json apps/server/package-lock.json ./apps/server/
RUN cd apps/server && npm ci --omit=dev && npm cache clean --force
# Writable data dir for the SQLite fallback (DB_DRIVER=dev, used when no
# DATABASE_URL is provided — e.g. the CI boot smoke test).
RUN mkdir -p /repo/apps/server/data && chown node:node /repo/apps/server/data

# Layout mirrors the repo so the server's default clientDist
# (apps/server/{dist,}/../../client/dist) resolves without configuration.
COPY --from=server-build /repo/apps/server/dist ./apps/server/dist
COPY --from=client-build /repo/apps/client/dist ./apps/client/dist

WORKDIR /repo/apps/server
# Runs as the unprivileged `node` user shipped with the image.
USER node
EXPOSE 4600

# PORT defaults to 4600 (config.ts); Render injects its own (10000).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-4600}/api/v1/health" >/dev/null || exit 1

CMD ["node", "dist/index.js"]

