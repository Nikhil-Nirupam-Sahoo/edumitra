/**
 * Playback controller for audio-assisted learning.
 *
 * Low-literacy students need audio cues on every card. This hook keeps a
 * SINGLE HTMLAudioElement alive (important on low-end devices — creating one
 * element per cue leaks memory) and plays from a local, content-hashed file
 * cached by the service worker. Failure is silent: learning continues without
 * audio.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface PlaybackState {
  playingId: string | null;
  unavailableId: string | null;
}

export interface UseAudioCuesResult extends PlaybackState {
  play(cueId: string, source: string): void;
  stop(): void;
}

export function useAudioCues(): UseAudioCuesResult {
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [unavailableId, setUnavailableId] = useState<string | null>(null);

  const ensureElement = useCallback((): HTMLAudioElement | null => {
    if (typeof Audio === 'undefined') return null;
    if (!elementRef.current) {
      const element = new Audio();
      element.preload = 'none'; // never burn bandwidth until the student asks
      element.setAttribute('playsinline', 'true');
      element.onended = () => setPlayingId(null);
      element.onerror = () => {
        setPlayingId(null);
      };
      elementRef.current = element;
    }
    return elementRef.current;
  }, []);

  const stop = useCallback(() => {
    const element = elementRef.current;
    if (element) {
      element.pause();
      element.removeAttribute('src');
    }
    setPlayingId(null);
  }, []);

  const play = useCallback(
    (cueId: string, source: string) => {
      const element = ensureElement();
      if (!element || !source) {
        setUnavailableId(cueId);
        return;
      }
      try {
        // Re-tapping the active cue acts as a stop toggle.
        if (playingId === cueId && !element.paused) {
          stop();
          return;
        }
        setUnavailableId(null);
        if (element.src && !element.src.endsWith(source)) {
          element.pause();
        }
        element.src = source;
        element.currentTime = 0;
        const promise = element.play();
        setPlayingId(cueId);
        if (promise && typeof promise.catch === 'function') {
          promise.catch(() => {
            // Autoplay policy or missing file: degrade gracefully.
            setPlayingId(null);
            setUnavailableId(cueId);
          });
        }
      } catch {
        setPlayingId(null);
        setUnavailableId(cueId);
      }
    },
    [ensureElement, playingId, stop],
  );

  // Release the audio element on unmount / lesson change.
  useEffect(() => {
    return () => {
      stop();
      elementRef.current = null;
    };
  }, [stop]);

  return useMemo(
    () => ({ playingId, unavailableId, play, stop }),
    [playingId, unavailableId, play, stop],
  );
}

/**
 * Resolves a content-addressed media path to a locally servable URL. Media is
 * precached by the service worker under /media/, so this is offline-safe.
 */
export function mediaUrl(path: string): string {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  if (path.startsWith('/media/')) return path;
  return `/media/${path.replace(/^\/+/, '')}`;
}
