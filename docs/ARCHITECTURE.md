# EduMitra Architecture

A field reference for how this app is built and why. Written to be readable by
someone new to the codebase, and to record the reasoning behind the choices
that matter.

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Client | React 19 + TypeScript + Vite | hash router, no router dependency |
| Client runtime deps | **none** beyond `react`/`react-dom` | router, state, i18n, charts, animation are all first-party |
| Client storage | IndexedDB (raw API) | lessons, progress, XP, translations, cached audio & photos |
| Client tests | Vitest + jsdom + fake-indexeddb | real components against a real (fake) IndexedDB |
| Server | Node + Fastify 5 + TypeScript | Zod validation, `pg` in production |
| Server storage | SQLite (dev) → PostgreSQL (prod) | one `DbPort` interface; `?` placeholders rewritten for pg |
| Deploy | Render free tier, one Docker container | serves the API *and* the built PWA from a single origin |

Current budget: **bundle ≈ 436 kB raw / 130 kB gzip**; client **248** tests,
server **133** tests; typecheck and both builds green.

---

## 2. The four rules everything follows

**1. The server owns secrets and third parties.** The browser only ever talks
to its own origin. API keys live in the server environment and are proxied —
anything prefixed `VITE_` is inlined into the bundle and readable by every
visitor.

**2. Nothing is hotlinked.** Curriculum, photographs, synthesised audio and
translations are all fetched from the server and cached on the device. A remote
`<img>` or a client-side API key is a broken box the moment a student loses
signal.

**3. Curriculum is data, not bundle.** `content/` and `images/` live in the
repo, are served under `/api/v1/*`, download into IndexedDB, and then the app
is fully offline. Updating a chapter is a content-only deploy; the PWA bundle
is untouched.

**4. Degrade, never fail.** Every optional feature has a real fallback, so
losing the network or a key costs capability, never function.

---

## 3. Request topology

```
                    ┌──────────────────────────────┐
   browser ─────────│ hash router → screens ────────┼──→ IndexedDB
      │             └──────────────────────────────┘        (source of truth)
      │  sync engine: batching · HMAC signing · offline queue
      └──→ /api/v1/*  ──→ Fastify ──→ SQLite (dev) / PostgreSQL (prod)
             │                   └──→ Google / Bhashini / AI provider
             │                        (keys stay server-side only)
             ├── /content/{manifest,packs}    ← content/
             ├── /images/{manifest,:name}     ← images/
             ├── /translate · /translate/content
             ├── /tts
             ├── /auth/*
             ├── /support/*
             └── /sync/*
```

---

## 4. The write path (why nothing is ever lost)

1. The student interacts. `LessonViewer` builds an immutable xAPI statement
   (client timestamp, device id, deterministic statement id) and writes it into
   `xapi_queue` **and** mutates `student_progress` in one IndexedDB
   transaction.
2. The sync engine *marks*, never deletes: rows go `synced` first; a separate
   storage-maintenance pass purges them afterwards.
3. A failed POST leaves rows `pending`. Exponential backoff retries forever.
4. Server-side, statement ids form a dedupe ledger, so a retried batch is
   idempotent rather than double-counted.
5. Progress merges are monotonic per checkpoint: completion never regresses,
   score keeps the best attempt, the resume position keeps the furthest card,
   time accumulates.

---

## 5. Feature reference

### 5.1 Offline-first sync engine
`apps/client/src/sync/syncEngine.ts` — batches queued statements, gzip/brotli
compresses them, signs the **decompressed** body with HMAC-SHA256 plus a
timestamp, and posts with the identity/compression/signature headers. The
server captures the raw body after decompressing (Fastify does not do this by
itself) and verifies against that exact string.

### 5.2 Auth and roles
`apps/server/src/auth/*` — scrypt + per-password salt, stateless HMAC sessions,
role read from the **database row** rather than a token claim. `requireRole`
enforces gating server-side; the client's role check is UI tidiness only.
The session hook is registered on the **root** Fastify instance — Fastify
encapsulates hooks per plugin scope, so registering it inside the auth plugin
left the sibling support routes unable to see `request.auth` at all.

### 5.3 Content packs
`content/manifest.json` + `content/packs/*.json` → `content.client.ts`.
Version-aware: a bump triggers a re-download and invalidates cached
translations made from the old content.

### 5.4 Gamification engine
`src/gamification/*` — XP, levels, streaks, stars, 13 badges, 6 daily quests,
combo multiplier, all *derived* from the XP event rows rather than stored as
mutable state. The store caches its snapshot; rebuilding it every render
produced an infinite "rendered more hooks than the previous render" loop.

### 5.5 Mini-games
`src/games/bank.ts` derives questions from the quiz cards already in the
lessons, and term→definition pairs from each chapter's intro. Four modes:
Blitz (60 s, combo multiplier), Sprint, True/False, Memory Match. Nothing is
hand-written per question, so games and curriculum cannot drift apart.

### 5.6 Reels
`src/modules/reels/Reels.tsx` — vertical snap-scrolling feed, one idea per
card: chapter photograph + `LessonArt` figure + a one-tap check question.

### 5.7 Mentor requests and AI tutor
`apps/server/src/support/*` — student questions are stored (migration
`0005_support_requests`), surface in the teacher's dashboard inbox, and a
student only ever sees their own thread. The AI tutor is a server-side proxy;
with no key configured the endpoint reports `aiEnabled: false` and the panel
says so rather than imitating a bot.

### 5.8 Lesson viewer and figures
`src/modules/lesson/LessonViewer.tsx` renders cards from
`lessonModel.ts` (data only — no executable lesson code, so payloads stay small
and rendering is deterministic). `src/art/figures.tsx` holds one Manim-style
figure per chapter: draw-on strokes (`stroke-dashoffset`), objects travelling
paths, labelled axes. All SVG + CSS, so it is offline, crisp at any density and
freezes under `prefers-reduced-motion`. `tests/figures.test.ts` fails if any
lesson lacks a figure, which is how generic decoration was eliminated.

### 5.9 i18n
`src/i18n/index.ts` — bundled locales (English, हिन्दी, தமிழ், ଓଡ଼ିଆ) work with
zero setup and no network. Lookup order: requested locale → subtag (`hi-IN` →
`hi`) → English → the key itself, so a missing key never blanks a screen.
Any further language is translated on demand by a provider chain, cached on the
device, and works offline from then on.
`tests/i18n.bundles.test.ts` enforces key parity, placeholder parity, no
untranslated values, and that each language is written in its own script.

### 5.10 Read-aloud (TTS)
`src/tts/*` — the server proxies synthesis, the client caches the audio, and if
that is unavailable the device's own `speechSynthesis` voices are used. A voice
is *never* substituted for an unrelated language: silence beats reading Hindi to
a Tamil student.

### 5.11 Lesson content translation
`apps/server/src/translate/content-translate.controller.ts` — the reason
lessons stayed English was that the UI was translated while cards shipped as
English JSON. This translates a lesson's cards — titles, bodies, quiz questions,
**every option**, explanations — in one request per lesson, preserving card ids
so progress tracking is untouched. English renders first and upgrades when the
translation lands, so opening a lesson is never blocked on the network. Any
field a provider omits keeps its English source: a partly translated card is
usable, an empty one is not.

### 5.12 Scroll animations
`src/anim/scroll.ts` — IntersectionObserver + CSS transitions, with anime.js's
vocabulary (durations, easing curves, staggered delays) but not its 17 kB.
Reveals fail safe in every direction: no IntersectionObserver, reduced motion,
or an observer that never fires all end with content visible.

### 5.13 Teacher analytics
`src/charts/Charts.tsx` + `src/db/analytics.ts` — hand-rolled SVG (line, bar,
radar, heatmap, sparkline) rather than a 60–150 kB charting library. Per-student
drill-down: score trend, subject mastery, activity heatmap, weakest/strongest
chapters for reteaching; plus class-level mastery to distinguish one student's
gap from the whole class's. Every chart carries a visually-hidden data table.
`score` is `-1` until a student has a graded interaction — those rows are
excluded from means, or a student who just started appears worse than one who
genuinely scored 0%.

### 5.14 Photographs
`images/` — 31 CC-licensed Wikimedia photographs, served from
`/api/v1/images/*` with attribution. Picked by eye from generated contact
sheets, because Commons search is good enough to shortlist and not to choose
("assembly line factory workers" returns an armoured car). Picks that must not
drift are pinned by Commons title rather than index, since search ordering is
not stable between runs.

---

## 6. Third-party integrations

| Service | Env var | Needed for | Cost |
|---|---|---|---|
| Google Cloud Translation | `GOOGLE_TRANSLATION_API_KEY` | higher-quality UI + content translation | **billing account** |
| Bhashini (Govt of India) | `BHASHINI_API_KEY` | free translation fallback, Odia TTS | free key, no card |
| Anthropic | `ANTHROPIC_API_KEY` | AI tutor in Help | paid |
| Google Cloud TTS | (same key as translation) | best read-aloud voices | billing account |

**All are optional.** The app works with none of them set.

**Known issue:** MyMemory is free and keyless, so it is the default translation
provider, but its anonymous quota is per-IP and Render's shared free-tier egress
is already rate-limited (`429`). Setting `BHASHINI_API_KEY` makes translation
survive regardless.

---

## 7. Commands

```bash
npm run setup          # install both apps
npm run dev:server     # Fastify on :4600
npm run dev:client     # Vite on :5173
npm test               # server + client suites
npm run typecheck      # tsc --noEmit in both apps
npm run build          # server tsc build + client vite build
```

---

## 8. Where the traps are

Places that have already produced bugs once, and the reason the current code
looks the way it does:

- **Fastify hooks are scoped per plugin.** A hook registered inside one
  `app.register()` does not run for sibling scopes. Session hooks belong on the
  root instance.
- **Hooks must live above every early return.** A `useMemo` below a conditional
  return is skipped on the first render and called on the next — React rejects
  it and the screen goes blank.
- **A `setState` updater must stay pure.** Firing an async finish handler inside
  one breaks under StrictMode's double-invocation.
- **`score: -1` means "not graded yet",** not "scored zero".
- **Provider responses can be short.** Fill every gap from the source string; a
  blank field is worse than an untranslated one.
- **Postgres returns BIGINT as a string.** Normalise at the query boundary or
  timestamps compare wrongly.
- **Store a cached `getSnapshot()` for `useSyncExternalStore`,** or re-rendering
  becomes a render loop.
- **jsdom lacks object URLs and speech synthesis,** and Node ≥ 22 shadows
  `localStorage` — all shimmed in `vitest.setup.ts`.
