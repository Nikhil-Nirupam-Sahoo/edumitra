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

## Live translation (optional)

The app ships with bundled UI translations for **English, Hindi and Tamil**.
Those work instantly and fully offline.

Any other language is translated on demand through `POST /api/v1/translate`.
The browser never holds a Google API key — it asks our server, the server
holds the key and proxies to Google Cloud Translation v2. Results are cached
in memory on the server and in `localStorage` on the device, so a language is
translated once and is instant (and offline) from then on.

**To enable it:**

1. Create an API key in Google Cloud with the **Cloud Translation API** enabled.
2. **Restrict the key**: Application restrictions → restrict to your server's
   egress IPs, and API restrictions → Cloud Translation API only. An
   unrestricted key will be found and abused against your billing account.
3. Set it on the service (Render dashboard → your service → Environment):

   ```
   GOOGLE_TRANSLATION_API_KEY = <your key>
   ```

4. In the app: **Settings → Translate the app into…** → pick a language.

If the key is unset, `/api/v1/translate/status` returns `{"enabled": false}`
and the picker reports that live translation is unavailable. Bundled locales
remain fully functional — translation is an enhancement, never a dependency.

```bash
# Check whether it's on
curl https://<your-host>/api/v1/translate/status
# {"enabled":true}
```
