/**
 * Device identity for multi-device classrooms.
 *
 * A stable random UUID is generated once and cached in localStorage so all
 * statements from this handset are attributable during merge. Falls back to a
 * per-session id when storage is unavailable (private mode), which is still
 * safe: statement ids remain globally unique and the merge is idempotent.
 */

const STORAGE_KEY = 'edumitra.device_id';
let cached: string | null = null;

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC4122 v4 fallback for older WebViews.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function getDeviceId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
    const fresh = randomId();
    localStorage.setItem(STORAGE_KEY, fresh);
    cached = fresh;
    return fresh;
  } catch {
    cached = randomId();
    return cached;
  }
}

/** Test-only: forget the cached device id. */
export function __resetDeviceIdForTests(): void {
  cached = null;
}
