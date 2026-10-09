/**
 * useSpeech — React binding for the Web Speech reader.
 *
 * Speaks a labelled chunk of text, exposes whether reading is currently
 * happening so the UI can show a speaking state, and stops cleanly on unmount.
 * A missing voice is a first-class outcome, not an error: the caller simply
 * does not render the button.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canSpeak,
  rateForLocale,
  speak,
  speechSupported,
  stopSpeaking,
} from './speech';

export interface UseSpeechResult {
  /** False when the platform can't speak at all. */
  supported: boolean;
  /** False when there is no voice for this language. */
  available: boolean;
  /** Id currently being read, or null. */
  speakingId: string | null;
  /** Reads `text`; tapping the same id again stops it. */
  read: (id: string, text: string) => void;
  stop: () => void;
}

export function useSpeech(locale: string): UseSpeechResult {
  const supported = useMemo(() => speechSupported(), []);
  const available = useMemo(() => (supported ? canSpeak(locale) : false), [supported, locale]);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const currentId = useRef<string | null>(null);

  const stop = useCallback(() => {
    stopSpeaking();
    currentId.current = null;
    setSpeakingId(null);
  }, []);

  const read = useCallback(
    (id: string, text: string) => {
      // Re-tapping the active button acts as a stop toggle.
      if (currentId.current === id) {
        stop();
        return;
      }
      stopSpeaking();
      currentId.current = id;
      const started = speak(text, {
        locale,
        rate: rateForLocale(locale),
        onEnd: () => {
          if (currentId.current === id) {
            currentId.current = null;
            setSpeakingId(null);
          }
        },
        onError: () => {
          if (currentId.current === id) {
            currentId.current = null;
            setSpeakingId(null);
          }
        },
      });
      if (!started) {
        currentId.current = null;
        setSpeakingId(null);
        return;
      }
      setSpeakingId(id);
    },
    [locale, stop],
  );

  // Never leave a voice talking after the screen goes away.
  useEffect(() => stop, [stop]);

  return { supported, available, speakingId, read, stop };
}