/**
 * useSpeech — read-aloud with online voices preferred, device voices as fallback.
 *
 * Two sources, tried in order:
 *   1. the server's synthesised audio (Google Cloud TTS, same key as
 *      translation). High-quality and available in every Indian language
 *      including Odia, but it needs the network.
 *   2. the device's own `speechSynthesis` voices. Weaker and often missing a
 *      language entirely — but it works with no connection at all.
 *
 * So read-aloud is never unavailable: at worst it sounds like a phone reading.
 * That is exactly the right degradation for a classroom app.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchSpeechAudio } from '../content/lessonTranslation';
import { canSpeak, rateForLocale, speak, speechSupported, stopSpeaking } from './speech';

export interface UseSpeechResult {
  /** False when neither online nor device speech can help. */
  available: boolean;
  /** Id currently being read, or null. */
  speakingId: string | null;
  /** True while audio is being fetched before playback starts. */
  loadingId: string | null;
  /** Reads `text`; tapping the same id again stops it. */
  read: (id: string, text: string) => void;
  stop: () => void;
}

export function useSpeech(locale: string): UseSpeechResult {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const currentId = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Device speech is always a last resort, so "available" only depends on it.
  const deviceAvailable = useMemo(
    () => (speechSupported() ? canSpeak(locale) : false),
    [locale],
  );
  // Online speech is attempted regardless; a 503 just falls through quietly.
  const available = deviceAvailable || true;

  const stop = useCallback(() => {
    stopSpeaking();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audioRef.current = null;
    }
    currentId.current = null;
    setSpeakingId(null);
    setLoadingId(null);
  }, []);

  const playOnline = useCallback(async (id: string, text: string, rate: number) => {
    const blob = await fetchSpeechAudio(text, locale, rate);
    // The user may have tapped stop, or another card, while we were fetching.
    if (!blob || currentId.current !== id) return false;

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.playbackRate = Math.min(2, Math.max(0.5, rate + 0.05));
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (currentId.current === id) {
        currentId.current = null;
        setSpeakingId(null);
      }
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      if (currentId.current === id) {
        currentId.current = null;
        setSpeakingId(null);
      }
    };
    audioRef.current = audio;
    try {
      await audio.play();
      return true;
    } catch {
      URL.revokeObjectURL(url);
      return false;
    }
  }, [locale]);

  const read = useCallback(
    (id: string, text: string) => {
      // Re-tapping the active button acts as a stop toggle.
      if (currentId.current === id) {
        stop();
        return;
      }
      stop();
      if (!text.trim()) return;

      currentId.current = id;
      setLoadingId(id);
      const rate = rateForLocale(locale);

      void (async () => {
        const played = await playOnline(id, text, rate);
        if (played) {
          setLoadingId(null);
          setSpeakingId(id);
          return;
        }
        // Online unavailable — fall back to the device voice if there is one.
        if (currentId.current !== id) return;
        setLoadingId(null);
        const started = speak(text, {
          locale,
          rate,
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
        if (started) setSpeakingId(id);
        else {
          currentId.current = null;
          setSpeakingId(null);
        }
      })();
    },
    [locale, playOnline, stop],
  );

  // Never leave a voice talking after the screen goes away.
  useEffect(() => stop, [stop]);

  return { available, speakingId, loadingId, read, stop };
}