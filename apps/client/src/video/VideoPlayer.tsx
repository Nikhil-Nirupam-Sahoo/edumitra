/**
 * VideoPlayer — streams a lecture and tracks the student's progress.
 *
 * Two honest playback paths:
 *   - YouTube lectures play through the official YouTube IFrame
 *     player, which is the only sanctioned way to embed a YouTube
 *     video. It also provides YouTube's own multilingual captions
 *     (including auto-translated tracks) and playback-speed control.
 *   - Self-hosted / direct sources play through a <video> element
 *     with our own colourful, multilingual subtitle overlay and a
 *     real offline download (cached via the Cache API).
 *
 * We do NOT download YouTube videos — that is not permitted by
 * YouTube's terms and cannot work reliably, so the button is
 * honest about what it does: a YouTube lecture streams online and
 * its subtitles can be saved for offline reading.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseVTT, type ParsedVTTCue } from './vtt';
import {
  fetchSubtitleText,
  getVideoDownloadManifest,
  saveVideoProgress,
} from './api';
import { translate as _t, createTranslator, type LocaleCode } from '../i18n';
import type { SubtitleTrack } from './types';

export interface VideoPlayerVideo {
  id: string;
  title: string;
  source: 'youtube' | 'local' | 'diksha' | 'other';
  source_url: string;
  youtube_id: string | null;
  thumbnail_webp: string | null;
  subtitles: SubtitleTrack[];
}

interface VideoPlayerProps {
  video: VideoPlayerVideo;
  studentId: string;
  locale: LocaleCode;
  onProgress?: (progress: { position_sec: number; completed: boolean }) => void;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const DEFAULT_SUBTITLE_COLOR = '#7cf03d';
const DEFAULT_SUBTITLE_BG = 'rgba(0, 0, 0, 0.82)';

/** Minimal, dependency-free typing for the YouTube IFrame API. */
declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: Record<string, unknown>,
      ) => YTPlayer;
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  getDuration: () => number;
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  setPlaybackRate: (rate: number) => void;
  getPlaybackRate: () => number;
  getAvailablePlaybackRates: () => number[];
  setVolume: (volume: number) => void;
  isMuted: () => boolean;
  mute: () => void;
  unMute: () => void;
  loadModule: (module: string) => void;
  getVideoEmbedCode: () => string;
  addEventListener: (event: string, cb: (e: unknown) => void) => void;
  destroy: () => void;
}

let ytApiPromise: Promise<void> | null = null;

/** Loads the YouTube IFrame API exactly once. */
function loadYouTubeIframeAPI(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<void>((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => resolve(); // resolve anyway so the UI can show an error
    document.body.appendChild(script);
  });
  return ytApiPromise;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function VideoPlayer({
  video,
  studentId,
  locale,
  onProgress,
}: VideoPlayerProps) {
  const { t } = createTranslator(locale);
  const isYouTube = video.source === 'youtube' && !!video.youtube_id;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayer | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const subtitleCuesRef = useRef<ParsedVTTCue[]>([]);
  const lastSavedRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [pip, setPip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [subtitleLang, setSubtitleLang] = useState<string | null>(null);
  const [subtitleColor, setSubtitleColor] = useState(DEFAULT_SUBTITLE_COLOR);
  const [subtitleBg, setSubtitleBg] = useState(DEFAULT_SUBTITLE_BG);
  const [activeCue, setActiveCue] = useState<ParsedVTTCue | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showControls, setShowControls] = useState(true);

  const availableSubtitles = video.subtitles;

  /* ---------------- progress persistence ---------------- */
  const reportProgress = useCallback(
    (positionSec: number, dur: number) => {
      const completed = dur > 0 && positionSec >= dur * 0.95;
      onProgress?.({ position_sec: positionSec, completed });
      const now = Date.now();
      if (now - lastSavedRef.current > 5000) {
        lastSavedRef.current = now;
        void saveVideoProgress(video.id, {
          position_sec: positionSec,
          completed,
          playback_speed: playbackRate,
          subtitle_lang: subtitleLang ?? undefined,
          subtitle_color: subtitleColor,
          subtitle_bg: subtitleBg,
        });
      }
    },
    [onProgress, video.id, playbackRate, subtitleLang, subtitleColor, subtitleBg],
  );

  const startProgressTimer = useCallback(
    (getPosition: () => number, getDuration: () => number) => {
      if (progressTimerRef.current) window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = window.setInterval(() => {
        const pos = getPosition();
        setCurrentTime(pos);
        reportProgress(pos, getDuration());
      }, 1000);
    },
    [reportProgress],
  );

  const stopProgressTimer = useCallback(() => {
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  /* ---------------- YouTube path ---------------- */
  useEffect(() => {
    if (!isYouTube || !containerRef.current) return;
    let disposed = false;
    let player: YTPlayer | null = null;

    void loadYouTubeIframeAPI().then(() => {
      if (disposed || !containerRef.current || !window.YT?.Player) {
        if (!window.YT?.Player) setError('Video player could not be loaded.');
        return;
      }
      // The container must be empty so a remount does not stack players.
      containerRef.current.replaceChildren();
      player = new window.YT.Player(containerRef.current, {
        videoId: video.youtube_id!,
        width: '100%',
        height: '100%',
        playerVars: {
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          cc_load_policy: 1,
          controls: 1,
        },
        events: {
          onReady: () => {
            if (disposed || !player) return;
            setDuration(player.getDuration());
            setReady(true);
            // Restore caption module so the language menu is populated.
            try {
              player.loadModule('cc');
            } catch {
              /* captions are optional */
            }
            startProgressTimer(
              () => player?.getCurrentTime() ?? 0,
              () => player?.getDuration() ?? 0,
            );
          },
          onStateChange: (e: unknown) => {
            if (disposed || !player) return;
            const state = (e as { data?: number })?.data;
            const states = window.YT?.PlayerState;
            if (state === states?.PLAYING) {
              setPlaying(true);
            } else if (state === states?.PAUSED) {
              setPlaying(false);
            } else if (state === states?.ENDED) {
              setPlaying(false);
              setCurrentTime(player.getDuration());
              reportProgress(player.getDuration(), player.getDuration());
            }
          },
          onError: () => {
            if (!disposed) setError('This lecture could not be played.');
          },
        },
      });
      ytPlayerRef.current = player;
    });

    return () => {
      disposed = true;
      stopProgressTimer();
      try {
        player?.destroy();
      } catch {
        /* already gone */
      }
      ytPlayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isYouTube, video.youtube_id]);

  /* ---------------- HTML5 path ---------------- */
  const loadSubtitleCues = useCallback(async (lang: string | null) => {
    if (!lang) {
      subtitleCuesRef.current = [];
      setActiveCue(null);
      return;
    }
    const text = await fetchSubtitleText(video.id, lang);
    subtitleCuesRef.current = text ? parseVTT(text) : [];
  }, [video.id]);

  useEffect(() => {
    if (isYouTube) return;
    // Prefer the first available track, or the user's saved language.
    const preferred =
      availableSubtitles.find((s) => s.lang === subtitleLang)?.lang ??
      availableSubtitles[0]?.lang ??
      null;
    setSubtitleLang(preferred);
    void loadSubtitleCues(preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isYouTube, video.id]);

  const findActiveCue = useCallback((time: number): ParsedVTTCue | null => {
    const cues = subtitleCuesRef.current;
    for (const cue of cues) {
      if (time >= cue.startTime && time < cue.endTime) return cue;
    }
    return null;
  }, []);

  const onTimeUpdate = useCallback(() => {
    const v = videoElRef.current;
    if (!v) return;
    const time = v.currentTime;
    setCurrentTime(time);
    setActiveCue(findActiveCue(time));
    reportProgress(time, v.duration || 0);
  }, [findActiveCue, reportProgress]);

  const onLoadedMetadata = useCallback(() => {
    const v = videoElRef.current;
    if (!v) return;
    setDuration(v.duration);
    setReady(true);
    startProgressTimer(
      () => videoElRef.current?.currentTime ?? 0,
      () => videoElRef.current?.duration ?? 0,
    );
  }, [startProgressTimer]);

  const onEnded = useCallback(() => {
    setPlaying(false);
    const v = videoElRef.current;
    if (v) reportProgress(v.duration, v.duration);
  }, [reportProgress]);

  /* ---------------- controls ---------------- */
  const togglePlay = useCallback(() => {
    if (isYouTube) {
      const p = ytPlayerRef.current;
      if (!p) return;
      if (playing) p.pauseVideo();
      else p.playVideo();
    } else {
      const v = videoElRef.current;
      if (!v) return;
      if (v.paused) void v.play().catch(() => {});
      else v.pause();
    }
  }, [isYouTube, playing]);

  const seek = useCallback(
    (seconds: number) => {
      if (isYouTube) {
        ytPlayerRef.current?.seekTo(Math.max(0, seconds), true);
        setCurrentTime(Math.max(0, seconds));
      } else {
        const v = videoElRef.current;
        if (!v) return;
        v.currentTime = Math.max(0, Math.min(seconds, v.duration || seconds));
        setCurrentTime(v.currentTime);
      }
    },
    [isYouTube],
  );

  const changeRate = useCallback(
    (rate: number) => {
      setPlaybackRate(rate);
      if (isYouTube) ytPlayerRef.current?.setPlaybackRate(rate);
      else if (videoElRef.current) videoElRef.current.playbackRate = rate;
    },
    [isYouTube],
  );

  const changeVolume = useCallback(
    (vol: number) => {
      setVolume(vol);
      setMuted(vol === 0);
      if (isYouTube) {
        const p = ytPlayerRef.current;
        if (!p) return;
        p.setVolume(Math.round(vol * 100));
        if (vol === 0) p.mute();
        else p.unMute();
      } else if (videoElRef.current) {
        videoElRef.current.volume = vol;
        videoElRef.current.muted = vol === 0;
      }
    },
    [isYouTube],
  );

  const toggleMute = useCallback(() => {
    changeVolume(muted ? volume || 1 : 0);
  }, [changeVolume, muted, volume]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!fullscreen) await containerRef.current?.requestFullscreen();
      else await document.exitFullscreen();
      setFullscreen(!fullscreen);
    } catch {
      /* fullscreen unsupported */
    }
  }, [fullscreen]);

  const togglePip = useCallback(async () => {
    if (isYouTube) return; // YouTube iframe does not support PiP via the element.
    const v = videoElRef.current;
    if (!v) return;
    try {
      if (!pip) await v.requestPictureInPicture();
      else await document.exitPictureInPicture();
      setPip(!pip);
    } catch {
      /* PiP unsupported */
    }
  }, [isYouTube, pip]);

  const changeSubtitle = useCallback(
    (lang: string | null) => {
      setSubtitleLang(lang);
      if (isYouTube) {
        // Ask the YouTube player to switch its caption track; the
        // player also exposes a full language + auto-translate menu.
        try {
          ytPlayerRef.current?.loadModule('cc');
        } catch {
          /* optional */
        }
      } else {
        void loadSubtitleCues(lang);
      }
    },
    [isYouTube, loadSubtitleCues],
  );

  /* ---------------- download (honest, per-source) ---------------- */
  const handleDownload = useCallback(async () => {
    if (isYouTube) {
      // YouTube's terms do not permit downloading the video. We save
      // the lecture's subtitles (where a track exists) and metadata
      // so the student can read them offline.
      setDownloading(true);
      try {
        const cache = await caches.open('edumitra-video-meta');
        const meta = new Response(
          JSON.stringify({
            id: video.id,
            title: video.title,
            source_url: video.source_url,
            youtube_id: video.youtube_id,
            saved_at: Date.now(),
          }),
          { headers: { 'content-type': 'application/json' } },
        );
        await cache.put(`/video-meta/${video.id}.json`, meta);
        const track = availableSubtitles[0];
        if (track) {
          const text = await fetchSubtitleText(video.id, track.lang);
          if (text) {
            await cache.put(
              `/video-subtitles/${video.id}.vtt`,
              new Response(text, { headers: { 'content-type': 'text/vtt' } }),
            );
          }
        }
        setSavedOffline(true);
      } catch {
        setError('Could not save for offline.');
      } finally {
        setDownloading(false);
      }
      return;
    }

    // Direct source: a real, playable offline copy.
    setDownloading(true);
    try {
      const manifest = await getVideoDownloadManifest(video.id, '480p');
      const url = manifest?.source_url ?? video.source_url;
      const response = await fetch(url);
      if (!response.ok) throw new Error('download_failed');
      const blob = await response.blob();
      const cache = await caches.open('edumitra-videos');
      await cache.put(url, new Response(blob));
      const track = availableSubtitles[0];
      if (track) {
        const text = await fetchSubtitleText(video.id, track.lang);
        if (text) {
          await cache.put(
            `/video-subtitles/${video.id}.vtt`,
            new Response(text, { headers: { 'content-type': 'text/vtt' } }),
          );
        }
      }
      setSavedOffline(true);
    } catch {
      setError('Download failed. Check your connection and try again.');
    } finally {
      setDownloading(false);
    }
  }, [isYouTube, video, availableSubtitles]);

  /* ---------------- auto-hide controls ---------------- */
  useEffect(() => {
    if (!playing) {
      setShowControls(true);
      return;
    }
    if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = window.setTimeout(() => setShowControls(false), 3000);
    return () => {
      if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current);
    };
  }, [playing, currentTime]);

  /* ---------------- keyboard shortcuts ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seek(currentTime - 10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seek(currentTime + 10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          changeVolume(Math.min(1, volume + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeVolume(Math.max(0, volume - 0.1));
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
          e.preventDefault();
          void toggleFullscreen();
          break;
        case '.':
        case '>':
          e.preventDefault();
          changeRate(Math.min(2, playbackRate + 0.25));
          break;
        case ',':
        case '<':
          e.preventDefault();
          changeRate(Math.max(0.5, playbackRate - 0.25));
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seek, currentTime, changeVolume, volume, toggleMute, toggleFullscreen, changeRate, playbackRate]);

  /* ---------------- cleanup ---------------- */
  useEffect(() => {
    return () => {
      stopProgressTimer();
      if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current);
    };
  }, [stopProgressTimer]);

  const showSubtitle = !isYouTube && activeCue && subtitleLang;

  return (
    <div
      className={`video-player ${fullscreen ? 'fullscreen' : ''}`}
      onMouseMove={() => setShowControls(true)}
      onMouseLeave={() => {
        if (playing) setShowControls(false);
      }}
    >
      <div className="video-container">
        {isYouTube ? (
          <div
            ref={containerRef}
            className="yt-player-host"
            data-youtube-id={video.youtube_id ?? undefined}
          />
        ) : (
          <video
            ref={videoElRef}
            src={video.source_url}
            poster={video.thumbnail_webp ?? undefined}
            className="video-element"
            playsInline
            preload="metadata"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
            onEnded={onEnded}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => setError('This lecture could not be loaded.')}
          />
        )}

        {/* Colourful subtitle overlay (direct sources) */}
        {showSubtitle && activeCue && (
          <div
            className="subtitle-overlay"
            aria-live="polite"
          >
            <span
              className="subtitle-text"
              style={{ color: subtitleColor, backgroundColor: subtitleBg }}
            >
              {activeCue.text}
            </span>
          </div>
        )}

        {!ready && !error && (
          <div className="video-loading" aria-busy="true">
            <div className="spinner" />
            <span>{_t(locale, 'common.loading')}</span>
          </div>
        )}

        {error && (
          <div className="video-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setError(null)}
            >
              {_t(locale, 'common.retry')}
            </button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div
        className={`video-controls ${showControls || !playing ? 'visible' : ''}`}
        onMouseMove={() => setShowControls(true)}
      >
        <div className="progress-bar">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label={_t(locale, 'common.progress')}
          />
          <span className="time-display">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        <div className="controls-row">
          <div className="controls-group">
            <button
              type="button"
              className="control-btn"
              onClick={togglePlay}
              aria-label={playing ? _t(locale, 'video.pause') : _t(locale, 'video.play')}
              disabled={!ready}
            >
              {playing ? '⏸' : '▶'}
            </button>
            <button
              type="button"
              className="control-btn"
              onClick={() => seek(currentTime - 10)}
              aria-label="Back 10 seconds"
              disabled={!ready}
            >
              ⏪
            </button>
            <button
              type="button"
              className="control-btn"
              onClick={() => seek(currentTime + 10)}
              aria-label="Forward 10 seconds"
              disabled={!ready}
            >
              ⏩
            </button>
          </div>

          <div className="controls-group controls-centre">
            <label className="control-select">
              <span className="sr-only">{_t(locale, 'video.subtitles')}</span>
              <select
                value={subtitleLang ?? ''}
                onChange={(e) => changeSubtitle(e.target.value || null)}
                disabled={isYouTube || availableSubtitles.length === 0}
                title={_t(locale, 'video.subtitles')}
              >
                <option value="">{_t(locale, 'video.captions_off')}</option>
                {availableSubtitles.map((s) => (
                  <option key={s.lang} value={s.lang}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-select">
              <span className="sr-only">{_t(locale, 'video.speed')}</span>
              <select
                value={playbackRate}
                onChange={(e) => changeRate(Number(e.target.value))}
                title={_t(locale, 'video.speed')}
              >
                {SPEED_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="controls-group">
            <button
              type="button"
              className="control-btn"
              onClick={toggleMute}
              aria-label={muted ? _t(locale, 'video.unmute') : _t(locale, 'video.mute')}
              disabled={!ready}
            >
              {muted || volume === 0 ? '🔇' : volume < 0.5 ? '🔈' : '🔊'}
            </button>
            <input
              type="range"
              className="volume-slider"
              min={0}
              max={1}
              step={0.1}
              value={volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              aria-label={_t(locale, 'video.mute')}
            />

            {!isYouTube && (
              <>
                <input
                  type="color"
                  value={subtitleColor}
                  onChange={(e) => setSubtitleColor(e.target.value)}
                  className="colour-picker"
                  aria-label={_t(locale, 'video.subtitle_colour')}
                  title={_t(locale, 'video.subtitle_colour')}
                />
                <input
                  type="color"
                  value={subtitleBg}
                  onChange={(e) => setSubtitleBg(e.target.value)}
                  className="colour-picker"
                  aria-label={_t(locale, 'video.subtitle_background')}
                  title={_t(locale, 'video.subtitle_background')}
                />
              </>
            )}

            {!isYouTube && (
              <button
                type="button"
                className="control-btn"
                onClick={() => void togglePip()}
                aria-label={_t(locale, 'video.pip')}
                disabled={!ready || pip}
              >
                🔲
              </button>
            )}

            <button
              type="button"
              className="control-btn"
              onClick={() => void toggleFullscreen()}
              aria-label={fullscreen ? _t(locale, 'video.exit_fullscreen') : _t(locale, 'video.fullscreen')}
            >
              ⛶
            </button>

            <button
              type="button"
              className="control-btn download-btn"
              onClick={() => void handleDownload()}
              disabled={downloading || !ready}
              aria-label={_t(locale, 'video.save_offline')}
              title={
                isYouTube
                  ? _t(locale, 'video.stream_note')
                  : _t(locale, 'video.save_offline')
              }
            >
              {downloading ? '⏳' : '⬇'}
            </button>
          </div>
        </div>

        {isYouTube && (
          <p className="video-source-note">{_t(locale, 'video.stream_note')}</p>
        )}
      </div>
    </div>
  );
}

export default VideoPlayer;
