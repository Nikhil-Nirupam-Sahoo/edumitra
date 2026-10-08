# EduMitra Architecture Notes

## 1. Why IndexedDB, not SQLite-WASM, on the web client

The target is a browser PWA on \$50–\$100 Android hardware. SQLite-WASM adds a
~1.2 MB WASM download (heavy on 2G/3G), must run inside a worker, and still
doesn't solve the PWA offline shell problem. IndexedDB:

- is available in every target browser and persists with storage permission;
- supports transactional writes in single-digit milliseconds on low-end devices;
- keeps the JS bundle small (no WASM fetch before first lesson renders).

The Flutter/WatermelonDB route remains viable for a native shell later: the
`DbPort`-shaped surface in `src/db/client.ts` (get/put/bulkPut, queued writes)
maps 1:1 onto WatermelonDB adapters, and the xAPI queue semantics are identical.

## 2. Zero-data-loss write path

1. Interaction happens (`LessonViewer`).
2. `xapiLogger` builds an immutable statement (client timestamp, device id,
   deterministic statement id) and writes it to `xapi_queue` in a single
   IndexedDB transaction. State is also mutated in `student_progress`.
3. The sync engine only *marks* (never deletes) during sync: `synced` first,
   then a storage-maintenance pass purges synced rows after `purgeAfterMs`.
4. A failed POST leaves rows `pending`; exponential backoff retries forever
   while the app is open, and again on next launch.

## 3. CRDT reconciliation model

Server-side `progress_state` is a KV-document register store:

```
(student_id, lesson_id, key) -> { value, ts, op, source_statement_id }
```

- **merge(register, checkpoint)** applies *if*
  `(ts, sourceId) > (existing.ts, existing.sourceId)` — a total order.
- `ts = max(statement.timestamp, serverStoredAt)` so operator clock drift
  cannot mask newer data.
- `op` semantics: `put` writes; `log-reading` keeps the max; `count-inc` adds.
- DAG heads (`progress_heads`) track the latest operation per lesson so new
  devices can bootstrap from `/api/v1/cmi5/state` without history replay.

This is append-only from the client's perspective: devices never need to
agree on ordering in real time, so multi-day offline periods can't overwrite
or lock out progress.

## 4. Sync scheduling & backpressure

- `SyncEngine.watch()` adapts to `navigator.onLine`, the `online` event, and a
  periodic jittered interval (`softIntervalMs`).
- One in-flight run at a time; runs are coalesced.
- Batches are chunked (`flushBatchSize`) so one interrupted request doesn't
  resend a 5 MB body.
- The server enforces body limit, batch size, and idempotency by statement id.

## 5. Security posture

- HMAC-SHA256 over `timestamp.body` with a shared secret; ±5 min clock skew.
- CORS locked to `CORS_ORIGINS`.
- Per-route rate limits (global, sync ingest, LRS queries).
- PII minimalism: statements carry pseudonymous actor ids (`schoolId/studentId`),
  no names inside xAPI payloads.

## 6. Low-end footprint budget (target < 150 MB RSS / heap)

- React + preact-style component granularity; no UI framework.
- Virtualized list rendering in `TeacherDashboard` (windowed, 25 rows).
- `requestIdleCallback` (fallback `setTimeout`) for sync runs.
- Audio via single HTMLAudioElement (`PlaybackController`), not one per cue.
- Images: WebP + `<img loading="lazy" decoding="async">`, CLS-safe dimensions.
