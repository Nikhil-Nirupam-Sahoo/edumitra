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

## Deploy (Render — free tier)

`render.yaml` is a one-click blueprint: **one web service** (the Fastify API
*also* serving the built PWA from the same origin — no CORS, one URL) plus a
managed PostgreSQL:

1. Push this repo to GitHub.
2. Render dashboard → **New + → Blueprint** → select the repo → **Apply**.
3. Done — the app is live at `https://edumitra.onrender.com` with HTTPS.

How the pieces fit:

- Render translates each service env var into a Docker build arg of the same
  name, so the generated `SYNC_SIGNING_SECRET` reaches the PWA bundle at
  build time and matches what the server verifies at runtime.
- `DATABASE_URL` (from Render Postgres) drives the driver/TLS automatically.
- Health checks hit `/api/v1/health`; the CI `docker` job builds the image
  and boots it with a smoke test on every push.

Caveats of the free tier: services spin down after 15 min idle (~1 min cold
start), and **free Render Postgres expires 30 days after creation**. For a
permanent zero-cost demo, create a free database at Neon (0.5 GB) and set
`DATABASE_URL` on the web service to its connection string instead.

## Deploy (Docker, self-hosted)

```bash
cp .env.example .env          # set SYNC_SIGNING_SECRET & DB_PASSWORD
docker compose up --build -d
curl http://localhost:4600/api/v1/health
```

Migrations run automatically on boot; the `pgdata` volume is enough for
persistence. A plain `docker build .` produces the same image Render uses.
