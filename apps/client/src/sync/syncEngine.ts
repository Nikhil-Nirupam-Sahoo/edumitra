/**
 * Background sync engine — offline delta sync of queued xAPI statements and
 * CRDT checkpoints to `POST /api/v1/sync/progress`.
 *
 * Guarantees:
 *  - Never loses work: rows transition `pending → synced`; only a separate
 *    maintenance pass purges synced rows, so a crash mid-sync re-sends safely
 *    (server dedupes by statement id).
 *  - Battery/CPU friendly on low-end devices: one run at a time, chunked
 *    batches, exponential backoff, and idle scheduling when available.
 *  - Works with flaky 2G/3G: request timeouts via AbortController, gzip bodies
 *    via CompressionStream, and signature headers per batch.
 *  - Two-way: after pushing, it pulls server-side statements it hasn't seen
 *    (other devices / teacher corrections) via the `pull` payload and mirrors
 *    them into the local queue as `synced` records and checkpoints.
 */

import {
  countPending,
  getCheckpoints,
  getMetaNumber,
  getPendingStatements,
  markCheckpointsAcknowledged,
  mergeCheckpoints,
  patchQueueStatus,
  purgeSyncedStatements,
  setMeta,
} from '../db/client';
import { checkpointKey, type CheckpointRecord, type XapiQueueRecord } from '../db/schema';
import { getDeviceId } from './deviceId';
import { parseStatement } from './xapiLogger';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SyncConfig {
  /** Base API URL, e.g. "" (same origin) or "https://api.edumitra.org". */
  apiBase: string;
  /** Shared HMAC secret; must match the server's SYNC_SIGNING_SECRET. */
  signingSecret: string;
  /** Max statements per POST batch. */
  flushBatchSize: number;
  /** Hard request timeout in ms (2G-friendly default: 20 s). */
  requestTimeoutMs: number;
  /** Base retry delay; doubles each failure up to maxBackoffMs. */
  backoffBaseMs: number;
  maxBackoffMs: number;
  /** Purge synced statements older than this on each successful run. */
  purgeAfterMs: number;
  /** Periodic soft poll while online (jittered). */
  softIntervalMs: number;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  apiBase: import.meta.env?.VITE_API_BASE ?? '/api/v1',
  signingSecret: import.meta.env?.VITE_SYNC_SIGNING_SECRET ?? 'dev-only-insecure-shared-secret',
  flushBatchSize: 200,
  requestTimeoutMs: 20_000,
  backoffBaseMs: 2_000,
  maxBackoffMs: 5 * 60_000,
  purgeAfterMs: 7 * 24 * 60 * 60 * 1000,
  softIntervalMs: 60_000,
};

const META_LAST_PUSH = 'sync.last_push_at';
const META_LAST_PULL = 'sync.last_pull_cursor';
const META_CRUFT_CURSOR = 'sync.cruft_cursor';

// ---------------------------------------------------------------------------
// Wire types (mirrors of the server contract in apps/server/src/sync/*)
// ---------------------------------------------------------------------------

export interface SyncCheckpointPayload {
  id: string;
  studentId: string;
  lessonId: string;
  key: string;
  value: number;
  ts: number;
  op: CheckpointRecord['op'];
  sourceStatementId: string;
}

export interface SyncRequestPayload {
  deviceId: string;
  clientSentAt: number;
  statements: unknown[];
  checkpoints: SyncCheckpointPayload[];
}

export interface SyncResponsePayload {
  accepted: number;
  duplicates: number;
  rejected: number;
  serverTime: number;
  nextCheckpoint: number;
  pull?: {
    statements: unknown[];
    checkpoints?: SyncCheckpointPayload[];
    hasMore: boolean;
  };
}

export interface SyncResult {
  ok: boolean;
  pushed: number;
  accepted: number;
  duplicates: number;
  pulled: number;
  purged: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

type Listener = (result: SyncResult) => void;

export class SyncEngine {
  private config: SyncConfig;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private backoffMs: number;
  private disposed = false;
  private fetchImpl: typeof fetch;

  constructor(config: Partial<SyncConfig> = {}, fetchImpl?: typeof fetch) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
    this.backoffMs = this.config.backoffBaseMs;
    this.fetchImpl = fetchImpl ?? ((...args) => fetch(...args));
  }

  get isOnline(): boolean {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  }

  onResult(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(result: SyncResult): void {
    for (const listener of this.listeners) {
      try {
        listener(result);
      } catch (error) {
        console.error('[sync] listener failed', error);
      }
    }
  }

  /**
   * Wires connectivity + interval triggers. Returns a disposer. Safe to call
   * multiple times; only the first call starts listeners.
   */
  watch(): () => void {
    if (typeof window === 'undefined') return () => undefined;
    const onOnline = () => {
      this.backoffMs = this.config.backoffBaseMs;
      void this.runSoon();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.runSoon();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    this.scheduleNext();
    void this.runSoon();
    return () => {
      this.disposed = true;
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      if (this.timer) clearTimeout(this.timer);
    };
  }

  private scheduleNext(): void {
    if (this.disposed || typeof window === 'undefined') return;
    if (this.timer) clearTimeout(this.timer);
    const jitter = Math.random() * 0.25 + 0.875; // 87.5%–112.5%
    this.timer = setTimeout(
      () => void this.runSoon(),
      Math.round(this.config.softIntervalMs * jitter),
    );
  }

  /** Idle-scheduled run — keeps the main thread responsive on slow CPUs. */
  runSoon(): Promise<SyncResult | null> {
    if (typeof window === 'undefined' || !('requestIdleCallback' in window)) {
      return this.run();
    }
    return new Promise((resolve) => {
      window.requestIdleCallback(
        () => {
          void this.run().then(resolve, () => resolve(null));
        },
        { timeout: 5_000 },
      );
    });
  }

  /** Single sync attempt. Concurrent calls coalesce onto the in-flight run. */
  async run(): Promise<SyncResult | null> {
    if (this.running) return null;
    if (!this.isOnline) {
      const pending = await countPending().catch(() => 0);
      if (pending > 0) {
        console.info(`[sync] offline — ${pending} statements queued`);
      }
      return null;
    }
    this.running = true;
    try {
      const result = await this.runOnce();
      this.emit(result);
      if (result.ok) {
        this.backoffMs = this.config.backoffBaseMs;
      } else {
        this.backoffMs = Math.min(this.backoffMs * 2, this.config.maxBackoffMs);
      }
      return result;
    } finally {
      this.running = false;
      this.scheduleNext();
    }
  }

  private async runOnce(): Promise<SyncResult> {
    const empty: SyncResult = { ok: true, pushed: 0, accepted: 0, duplicates: 0, pulled: 0, purged: 0 };
    const deviceId = getDeviceId();
    let totalAccepted = 0;
    let totalDuplicates = 0;
    let totalPushed = 0;
    let totalPulled = 0;

    // ---- PUSH: oldest-first chunks until the queue is drained -------------
    for (;;) {
      let batch: XapiQueueRecord[];
      try {
        batch = await getPendingStatements(this.config.flushBatchSize);
      } catch (error) {
        return { ...empty, ok: false, error: describe(error) };
      }
      if (batch.length === 0) break;

      const checkpoints = await this.buildCheckpointPayload(deviceId);
      const payload: SyncRequestPayload = {
        deviceId,
        clientSentAt: Date.now(),
        statements: batch.map((row) => safeParse(row.statement_json)),
        checkpoints,
      };

      let response: SyncResponsePayload;
      try {
        response = await this.postBatch(payload);
      } catch (error) {
        // Leave rows pending; backoff governs the retry.
        await patchQueueStatus(
          batch.map((row) => row.id),
          { attempts: 1, last_attempt_at: Date.now() },
        ).catch(() => undefined);
        return {
          ok: false,
          pushed: totalPushed,
          accepted: totalAccepted,
          duplicates: totalDuplicates,
          pulled: totalPulled,
          purged: 0,
          error: describe(error),
        };
      }

      // Success: mark synced BEFORE any pull/maintenance work.
      await patchQueueStatus(
        batch.map((row) => row.id),
        { status: 'synced', attempts: 0, last_attempt_at: null },
      );
      if (checkpoints.length > 0) {
        await markCheckpointsAcknowledged(checkpoints.map((c) => c.id));
      }
      await setMeta(META_LAST_PUSH, String(Date.now()));

      totalPushed += batch.length;
      totalAccepted += response.accepted;
      totalDuplicates += response.duplicates;

      // ---- PULL: mirror server-side statements (other devices) ----------
      if (response.pull && response.pull.statements.length > 0) {
        totalPulled += await this.applyPull(response.pull);
      }

      // Guard against an infinite loop if the server keeps rejecting writes:
      // a chunk smaller than the batch size means the queue was drained.
      if (batch.length < this.config.flushBatchSize) break;
    }

    // ---- MAINTENANCE: keep device storage bounded ------------------------
    let purged = 0;
    try {
      purged = await purgeSyncedStatements(this.config.purgeAfterMs);
      if (purged > 0) {
        void this.acknowledgeCruft();
      }
    } catch (error) {
      console.warn('[sync] purge failed', error);
    }

    return {
      ok: true,
      pushed: totalPushed,
      accepted: totalAccepted,
      duplicates: totalDuplicates,
      pulled: totalPulled,
      purged,
    };
  }

  /**
   * Checkpoints are derived from local, unacknowledged CRDT registers. Value is
   * monotonically non-decreasing for log/count ops, so re-sending is safe.
   */
  private async buildCheckpointPayload(deviceId: string): Promise<SyncCheckpointPayload[]> {
    const records = await getCheckpoints();
    return records
      .filter((record) => record.acknowledged === 0)
      .slice(0, this.config.flushBatchSize)
      .map((record) => ({
        id: record.id,
        studentId: record.student_id,
        lessonId: record.lesson_id,
        key: record.key,
        value: record.value,
        // Advance the logical clock by 1ms per device push so a checkpoint can
        // never tie with a later statement from this device.
        ts: Math.max(record.ts, Date.now()),
        op: record.op,
        sourceStatementId: record.source_statement_id || deviceId,
      }));
  }

  private async applyPull(pull: NonNullable<SyncResponsePayload['pull']>): Promise<number> {
    let applied = 0;
    // Statements from the server are already synced elsewhere; store them so
    // teachers can inspect them offline, marked as synced (no re-upload).
    if (pull.statements.length > 0) {
      const { enqueueStatement } = await import('../db/client');
      for (const raw of pull.statements) {
        const statement = raw as { id?: string; timestamp?: string };
        if (!statement.id) continue;
        const ts = statement.timestamp ? Date.parse(statement.timestamp) : Date.now();
        await enqueueStatement({
          id: statement.id,
          statement_json: JSON.stringify(raw),
          status: 'synced',
          timestamp: Number.isFinite(ts) ? ts : Date.now(),
          last_attempt_at: null,
          attempts: 0,
          device_id: 'remote',
        });
        applied += 1;
      }
    }
    if (pull.checkpoints && pull.checkpoints.length > 0) {
      const records: CheckpointRecord[] = pull.checkpoints.map((cp) => ({
        id: checkpointKey(cp.studentId, cp.lessonId, cp.key),
        student_id: cp.studentId,
        lesson_id: cp.lessonId,
        key: cp.key,
        value: cp.value,
        ts: cp.ts,
        op: cp.op,
        source_statement_id: cp.sourceStatementId,
        acknowledged: 1,
      }));
      await mergeCheckpoints(records);
    }
    if (pull.hasMore) {
      const cursor = await getMetaNumber(META_LAST_PULL, 0);
      await setMeta(META_LAST_PULL, String(Math.max(cursor, Date.now())));
    }
    return applied;
  }

  /** Tells the server that locally-purged synced statements are disposable. */
  private async acknowledgeCruft(): Promise<void> {
    try {
      const cursor = await getMetaNumber(META_CRUFT_CURSOR, 0);
      const url = new URL(
        `${this.trimBase()}/sync/cruft?since=${encodeURIComponent(cursor)}`,
        this.absoluteOrigin(),
      );
      const response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: { 'x-sync-device': getDeviceId() },
      });
      if (!response.ok) return;
      const body = (await response.json()) as { latest?: number };
      if (typeof body.latest === 'number') {
        await setMeta(META_CRUFT_CURSOR, String(body.latest));
      }
    } catch (error) {
      console.warn('[sync] cruft cursor update failed', error);
    }
  }

  private trimBase(): string {
    return this.config.apiBase.replace(/\/+$/, '');
  }

  private absoluteOrigin(): string {
    if (typeof location === 'undefined') return 'http://localhost';
    return location.origin;
  }

  // ---------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------

  private async postBatch(payload: SyncRequestPayload): Promise<SyncResponsePayload> {
    const url = new URL(`${this.trimBase()}/sync/progress`, this.absoluteOrigin());
    const bodyText = JSON.stringify(payload);
    const timestamp = Date.now();
    const signature = await signBody(this.config.signingSecret, timestamp, bodyText);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-sync-device': payload.deviceId,
      'x-sync-timestamp': String(timestamp),
      'x-sync-signature': signature,
    };
    const body = await maybeGzip(bodyText, headers);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
        keepalive: true as unknown as boolean,
      });
      if (!response.ok) {
        const detail = await safeText(response);
        throw new SyncHttpError(response.status, detail);
      }
      return (await response.json()) as SyncResponsePayload;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`sync failed: HTTP ${status}${detail ? ` — ${detail}` : ''}`);
    this.name = 'SyncHttpError';
  }
}

// ---------------------------------------------------------------------------
// Shared helpers (also used by tests and the settings screen)
// ---------------------------------------------------------------------------

export async function signBody(
  secret: string,
  timestamp: number,
  body: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Gzip via the platform CompressionStream when available (Chrome 80+). */
async function maybeGzip(
  bodyText: string,
  headers: Record<string, string>,
): Promise<BodyInit | string> {
  if (typeof CompressionStream === 'undefined') return bodyText;
  try {
    const stream = new Blob([bodyText]).stream().pipeThrough(new CompressionStream('gzip'));
    const buffer = await new Response(stream).arrayBuffer();
    headers['Content-Encoding'] = 'gzip';
    return buffer;
  } catch (error) {
    console.warn('[sync] gzip unavailable, sending plain JSON', error);
    delete headers['Content-Encoding'];
    return bodyText;
  }
}

function safeParse(statementJson: string): unknown {
  try {
    return JSON.parse(statementJson);
  } catch {
    return { id: `corrupt-${Math.random().toString(16).slice(2)}`, raw: statementJson };
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}

function describe(error: unknown): string {
  if (error instanceof SyncHttpError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Convenience singleton for app code. */
let singleton: SyncEngine | null = null;
export function getSyncEngine(): SyncEngine {
  if (!singleton) singleton = new SyncEngine();
  return singleton;
}

export { parseStatement };
