# EduMitra — Offline-First Learning Platform

A gamified, bilingual-capable learning PWA for Indian Classes 8–10 —
CBSE-aligned syllabus, Manim-style animated figures, 31 curated chapter
photographs, mini-games, a reels-style feed, mentor/AI support, read-aloud,
and per-student teacher analytics.

**Built to keep working when the network doesn't.** Every lesson, figure,
photograph and translation is fetched once, cached on the device, and then
works with the signal off. Losing connectivity costs capability, never function.

Live: **https://edumitra-1lot.onrender.com**
Demo logins — student `aarav`/`learn1234`, teacher `meera`/`teach1234`.

**[Full architecture and design notes → `docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**

---

## Layout

```
apps/client   React 19 + TypeScript + Vite PWA. Zero runtime dependencies
              beyond react — router, state, i18n, charts, scroll animation and
              gamification are all first-party. IndexedDB is the source of truth.

apps/server   Fastify 5 + TypeScript API. Sync ingest, content/photo serving,
              translation, TTS, auth, and mentor support. SQLite (dev) /
              PostgreSQL (prod) behind one dialect-portable DbPort.

content/      Downloaded curriculum — manifest.json + packs/*.json. 36 lessons.
              Server-owned data, NOT part of the client bundle.

images/       31 CC-licensed chapter photographs + attribution manifest.

scripts/      Content and image tooling (Wikimedia curation, contact sheets).
```

---

## Setup & run

```bash
./scripts/setup.sh
npm run dev:server   # Fastify on :4600
npm run dev:client   # Vite on :5173
```

## Verify

```bash
npm test          # server 133 tests + client 248 tests
npm run typecheck # tsc --noEmit in both apps
npm run build     # server tsc build + client vite build
```

Bundle budget: ≈436 kB raw / 130 kB gzip.

Never commit a real `.env` — see `.env.example` for the template.

---

## Optional integrations (all work without any of these)

| Service | Env var | Enables | Cost |
|---|---|---|---|
| Google Cloud Translation | `GOOGLE_TRANSLATION_API_KEY` | higher-quality UI + content translation | **billing account** |
| Bhashini (Govt of India) | `BHASHINI_API_KEY` | free translation fallback, Odia read-aloud | free key, no card |
| Google Cloud TTS | (same key as translation) | best read-aloud voices | billing account |
| Anthropic | `ANTHROPIC_API_KEY` | AI tutor in the Help tab | paid |

The browser never sees any of these keys — it calls our own endpoints and this
server proxies. Anything prefixed `VITE_` is inlined into the bundle and
readable by every visitor, so secrets are never put there.

**AI tutor**, **read-aloud** and **live translation of beyond-bundled
languages** are all off until a key is set; each one reports that honestly in
the UI instead of pretending to work.

> **Known issue:** MyMemory is free and keyless so it is the default
> translation provider, but its quota is per-IP and Render's shared free-tier
> egress is already rate-limited (`429`). Setting a free `BHASHINI_API_KEY`
> fixes translation without any billing.

---

## Deploy (Render — free tier)

`render.yaml` is a one-click blueprint: **one web service** (the Fastify API
*also* serving the built PWA from the same origin — no CORS, one URL) plus a
managed PostgreSQL.

1. Push this repo to GitHub.
2. Render dashboard → **New + → Blueprint** → select the repo → **Apply**.
3. The service deploys in 3–5 min; health checks hit `/api/v1/health`.

Render translates each service env var into a Docker build arg of the same
name, so the generated `SYNC_SIGNING_SECRET` reaches the PWA bundle at build
time and matches what the server verifies at runtime.

**Free-tier caveats:** services spin down after ~15 min idle (~1 min cold
start), and **free Render Postgres expires 30 days after creation**. For a
permanent zero-cost demo, create a free database at Neon (0.5 GB) and point
`DATABASE_URL` at it instead.

## Deploy (Docker, self-hosted)

```bash
cp .env.example .env          # set SYNC_SIGNING_SECRET & DB_PASSWORD
docker compose up --build -d
curl http://localhost:4600/api/v1/health
```

Migrations run on boot. A plain `docker build .` produces the image Render uses.

---

## Languages

Bundled and fully offline with **zero setup**: English, हिन्दी, தமிழ், ଓଡ଼ିଆ.

Any other language is translated on demand through
`/api/v1/translate` and `/api/v1/translate/content` (the latter translates the
**lesson content**, not just the interface). Results are cached in memory on the
server and on the device, so a language is translated once and is instant and
offline from then on.

To enable better quality: create a restricted Google Cloud Translation key and
set it on the service. See `.env.example` for the full list and the reasoning
behind each.

```bash
# Is live translation available, and which provider answers?
curl https://<your-host>/api/v1/translate/status
# {"enabled":true,"provider":"mymemory"}
```
