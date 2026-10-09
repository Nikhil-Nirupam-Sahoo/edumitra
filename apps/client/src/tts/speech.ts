/**
 * Text-to-speech via the Web Speech API.
 *
 * WHY NOT A SERVER TTS PROXY (like the translation key):
 *   Speech is the one feature a low-end, low-literacy classroom device cannot
 *   afford to lose. `speechSynthesis` is built into the browser, ships with
 *   offline voices on Android/Chrome, needs no API key, no network round trip
 *   and no audio megabytes in the bundle. A server proxy would make reading
 *   aloud — the most important accessibility feature here — depend on the one
 *   thing this app is built to survive without: connectivity.
 *
 * It is also honest about its limits: if the platform has no voice for the
 * student's language, the UI hides the button rather than reading gibberish.
 */

import { AUDIO_LOCALES } from '../i18n';

export interface SpeakOptions {
  /** BCP-47 tag to match a voice against, e.g. "hi" or "ta". */
  locale?: string;
  /** 0.5–1.5. Below 1 for learners reading a second language. */
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  onError?: () => void;
}

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis ?? null;
}

/** True when the platform can speak at all. */
export function speechSupported(): boolean {
  return synth() !== null && typeof window.SpeechSynthesisUtterance === 'function';
}

/**
 * Voices load asynchronously in Chromium (the list is empty until
 * `voiceschanged` fires), so a naive read at import time finds nothing and the
 * feature silently never appears.
 *
 * `getVoices()` is re-read on every lookup rather than cached: it is cheap in
 * practice, and a cache populated before the voices arrived would keep
 * reporting "no voice for Tamil" for the rest of the session. The last-known
 * list is still retained as a fallback for platforms whose `getVoices()`
 * intermittently returns empty.
 */
let lastVoices: SpeechSynthesisVoice[] = [];

function currentVoices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return [];
  let list: SpeechSynthesisVoice[] = [];
  try {
    list = s.getVoices() ?? [];
  } catch {
    list = [];
  }
  if (list.length > 0) lastVoices = list;
  return list.length > 0 ? list : lastVoices;
}

/**
 * Best voice for a locale.
 *
 * Prefers an exact match (hi-IN over hi), then the base language, and only
 * then any voice — a student who asked for Tamil and got Hindi would be better
 * served by silence than by a language they don't speak.
 */
export function pickVoice(locale: string | undefined): SpeechSynthesisVoice | null {
  const voices = currentVoices();
  if (voices.length === 0) return null;

  const wanted = (locale ?? 'en').toLowerCase();
  const base = wanted.split(/[-_]/)[0];

  const exact = voices.find((v) => v.lang.toLowerCase() === wanted);
  if (exact) return exact;
  const sameLanguage = voices.find((v) => v.lang.toLowerCase().split(/[-_]/)[0] === base);
  if (sameLanguage) return sameLanguage;

  // Only English is an acceptable last resort — every other bundled language
  // exists precisely because the student needs it.
  if (base !== 'en') return null;
  return voices.find((v) => v.lang.toLowerCase().startsWith('en')) ?? null;
}

/** Whether we can actually speak this language right now. */
export function canSpeak(locale: string | undefined): boolean {
  return speechSupported() && pickVoice(locale) !== null;
}

/** Speaks `text`, replacing anything currently being read. */
export function speak(text: string, options: SpeakOptions = {}): boolean {
  const s = synth();
  if (!s || typeof window.SpeechSynthesisUtterance !== 'function') return false;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return false;

  const voice = pickVoice(options.locale);
  if (!voice) return false;

  s.cancel();

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = clampRate(options.rate ?? 1);
  utterance.pitch = clamp(options.pitch ?? 1, 0, 2);
  if (options.onEnd) utterance.onend = options.onEnd;
  if (options.onError) utterance.onerror = options.onError;

  try {
    s.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking(): void {
  synth()?.cancel();
}

/** Reads a sequence of strings, e.g. a question then its explanation. */
export function speakSequence(
  parts: string[],
  options: SpeakOptions = {},
): boolean {
  const text = parts.filter(Boolean).join('. ');
  return speak(text, options);
}

function clampRate(rate: number): number {
  return clamp(rate, 0.5, 1.5);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Locale → a sensible default speaking rate. */
export function rateForLocale(locale: string): number {
  const base = (locale ?? 'en').toLowerCase().split(/[-_]/)[0] ?? 'en';
  // Reading in a second language is slower for everyone; nudge it down so a
  // Class 8 Hindi speaker reading an English lesson can keep up.
  return AUDIO_LOCALES.includes(base) && base !== 'en' ? 0.9 : 1;
}