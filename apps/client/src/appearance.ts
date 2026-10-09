/**
 * Appearance — user font size.
 *
 * The whole UI scales off `--font-size-base` on `html`, so a student
 * or teacher who wants larger text is a single property change that
 * reflows every rem-based size. The scale is remembered on the device
 * so it applies instantly on boot and while offline, and mirrored to
 * the server profile when a session exists.
 */

const FONT_KEY = 'edumitra.fontScale';
const BASE_PX = 17; // matches --font-size-base in styles.css

export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.3;
export const FONT_STEPS = [0.85, 1, 1.15, 1.3];

function clamp(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, scale));
}

/** The scale saved on the device, or 1 (default) when none/invalid. */
export function loadFontScale(): number {
  try {
    const raw = localStorage.getItem(FONT_KEY);
    if (!raw) return 1;
    return clamp(Number(raw));
  } catch {
    return 1;
  }
}

/** Applies the scale to the document and remembers it on the device. */
export function applyFontScale(scale: number): number {
  const value = clamp(scale);
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty(
      '--font-size-base',
      `${(BASE_PX * value).toFixed(1)}px`,
    );
  }
  try {
    localStorage.setItem(FONT_KEY, String(value));
  } catch {
    /* private mode — scale lasts for this session */
  }
  return value;
}
