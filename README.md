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
