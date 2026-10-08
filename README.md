# Edumitra — Offline-First Learning Platform

Entry-level smartphone & low-bandwidth friendly digital learning app.
100% offline learning / quiz / navigation, xAPI event queue, and background CRDT delta sync.

See `docs/ARCHITECTURE.md` for the full design notes.

## Layout

- `apps/client` — React + Vite PWA. Local-first IndexedDB store, hash routing,
  service-worker app shell, local i18n bundles (en/hi/ta/bn), offline lessons
  with audio cues, teacher dashboard with local analytics.
- `apps/server` — Fastify + TypeScript API. `POST /api/v1/sync/progress`
  (HMAC-signed, gzip, xAPI LRS ingest), CRDT progress merge, SQLite (dev) /
  PostgreSQL (prod) stores, optional Redis-backed job queue.

## Setup & run

```bash
./scripts/setup.sh
npm run dev:server   # Fastify on :4600
npm run dev:client   # Vite on :5173 (proxies /api to :4600)
```

## Verify

```bash
npm test          # server CRDT/HMAC tests + client IndexedDB write-path tests
npm run build     # server tsc build + client tsc + vite build
```

Environment template: `.env.example` (never commit a real `.env`).

## Deploy (Docker)

The server ships a multi-stage `apps/server/Dockerfile` (build → prod-deps-only
runner, non-root, health-checked at `/api/v1/health`), and the repo root has a
`docker-compose.yml` that pairs it with PostgreSQL 16:

```bash
cp .env.example .env
# set SYNC_SIGNING_SECRET=$(openssl rand -hex 32) and a real DB_PASSWORD
docker compose up --build -d
curl http://localhost:4600/api/v1/health
```

Migrations run automatically on boot; the `pgdata` volume is enough for
persistence. The PWA client builds to static files (`npm run build` in
`apps/client`) and can be hosted on any static host or CDN in front of the API.
