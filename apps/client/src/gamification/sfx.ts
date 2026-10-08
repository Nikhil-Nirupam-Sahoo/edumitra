/**
 * Sound effects — 100% synthesized WebAudio, no media files.
 *
 * The app ships silent-safe placeholders for real audio assets; these cues are
 * generated on the fly so rewards feel alive even fully offline. Every sound is
 * short (<=300ms), gentle, and respects the user's mute preference and the
 * system reduced-motion setting. No assets, no network, no dependencies.
 */

const SOUND_STORAGE_KEY = 'edumitra.sound';

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* storage unavailable (private mode) — nothing to persist */
  }
}

let audioContext: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (!isSoundEnabled()) return null;
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  if (matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return null;
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === 'suspended') void audioContext.resume();
  return audioContext;
}

/** One note: sine with a quick decay, low volume, tiny detune for richness. */
function tone(
  frequency: number,
  { at = 0, duration = 0.18, volume = 0.08, kind = 'sine' as OscillatorType } = {},
): void {
  const context = ctx();
  if (!context) return;
  const start = context.currentTime + at;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = kind;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

// Pentatonic ladder C-D-E-G-A so combos make an ascending, cheerful melody.
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0];

/** Correct answer: pitch rises with the combo — the sound of building a streak. */
export function playCorrect(combo: number): void {
  const degree = Math.min(Math.max(combo, 1), PENTATONIC.length) - 1;
  tone(PENTATONIC[degree]);
  if (combo >= 3) tone(PENTATONIC[degree] * 1.5, { at: 0.09, duration: 0.22 });
}

/** Wrong answer: a soft, low "nudge" — encouraging, never harsh. */
export function playWrong(): void {
  tone(196.0, { duration: 0.16, volume: 0.05, kind: 'triangle' });
}

/** Star fall on the lesson-complete overlay. */
export function playStar(count: number): void {
  tone(PENTATONIC[Math.min(count, PENTATONIC.length - 1)], { at: 0, duration: 0.22 });
  tone(PENTATONIC[Math.min(count, PENTATONIC.length - 1) + 1] ?? PENTATONIC[4], { at: 0.1, duration: 0.28 });
}

/** Quest completed: two cheerful pings. */
export function playQuest(): void {
  tone(659.25, { duration: 0.12 });
  tone(987.77, { at: 0.1, duration: 0.22 });
}

/** Level-up fanfare: an upward arpeggio. */
export function playLevelUp(): void {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((frequency, index) => tone(frequency, { at: index * 0.09, duration: 0.3 }));
}

/** Badge unlock: a bright two-note sparkle. */
export function playBadge(): void {
  tone(880.0, { duration: 0.12, volume: 0.07 });
  tone(1318.5, { at: 0.08, duration: 0.2, volume: 0.06 });
}