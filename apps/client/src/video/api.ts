/**
 * Video API client — talks to /api/v1/video endpoints.
 */

import { API_BASE } from '../content/client';
import type {
  VideoLecture,
  VideoProgress,
  VideoDownloadManifest,
  SubtitleTrack,
} from './types';

function token(): string | null {
  try {
    const raw = localStorage.getItem('edumitra.session');
    if (!raw) return null;
    return (JSON.parse(raw) as { token?: string }).token ?? null;
  } catch {
    return null;
  }
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const bearer = token();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`request_failed_${response.status}`);
  return (await response.json()) as T;
}

/** List videos with optional filters. */
export async function listVideos(filters: {
  board_id?: string;
  class_id?: string;
  subject?: string;
  lesson_id?: string;
  topic_id?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ videos: VideoLecture[]; total: number }> {
  const searchParams = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined) searchParams.append(k, String(v));
  });
  return authedFetch<{ videos: VideoLecture[]; total: number }>(
    `/video?${searchParams.toString()}`,
  );
}

/** Get a single video by ID. */
export async function getVideo(id: string): Promise<VideoLecture | null> {
  try {
    return await authedFetch<VideoLecture>(`/video/${id}`);
  } catch (e) {
    if ((e as Error).message.includes('404')) return null;
    throw e;
  }
}

/** Fetch subtitle file (VTT/SRT) and return as text. */
export async function fetchSubtitleText(videoId: string, lang?: string): Promise<string | null> {
  try {
    const params = new URLSearchParams();
    if (lang) params.set('lang', lang);
    const response = await fetch(`${API_BASE}/video/${videoId}/subtitles?${params.toString()}`, {
      headers: { ...(token() ? { authorization: `Bearer ${token()}` } : {}) },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/** Fetch subtitle track metadata. */
export async function getSubtitleTracks(videoId: string): Promise<SubtitleTrack[]> {
  try {
    const video = await getVideo(videoId);
    return video?.subtitles ?? [];
  } catch {
    return [];
  }
}

/** Get video progress for current student. */
export async function getVideoProgress(videoId: string): Promise<{
  position_sec: number;
  completed: boolean;
  playback_speed: number;
  subtitle_lang: string | null;
  subtitle_color: string | null;
  subtitle_bg: string | null;
} | null> {
  try {
    return await authedFetch(`/video/${videoId}/progress`);
  } catch {
    return null;
  }
}

/** Save video progress. */
export async function saveVideoProgress(
  videoId: string,
  data: {
    position_sec?: number;
    completed?: boolean;
    playback_speed?: number;
    subtitle_lang?: string;
    subtitle_color?: string;
    subtitle_bg?: string;
  },
): Promise<boolean> {
  try {
    await authedFetch(`/video/${videoId}/progress`, {
      method: 'POST',
      body: JSON.stringify({
        position_sec: data.position_sec,
        completed: data.completed,
        playback_speed: data.playback_speed,
        subtitle_lang: data.subtitle_lang,
        subtitle_color: data.subtitle_color,
        subtitle_bg: data.subtitle_bg,
      }),
    });
    return true;
  } catch {
    return false;
  }
}

/** Get download manifest for offline caching. */
export async function getVideoDownloadManifest(
  videoId: string,
  quality: '360p' | '480p' | '720p' = '480p',
): Promise<{
  video_id: string;
  title: string;
  source_url: string;
  youtube_id: string | null;
  quality: string;
  subtitles: SubtitleTrack[];
} | null> {
  try {
    return await authedFetch(`/video/${videoId}/download?quality=${quality}`);
  } catch {
    return null;
  }
}

/** Check if video is available offline. */
export async function isVideoCached(videoId: string): Promise<boolean> {
  try {
    const db = await import('../db/client').then(m => m.openDb());
    const tx = db.transaction('video_cache', 'readonly');
    const store = tx.objectStore('video_cache');
    const req = store.get(`video:${videoId}`);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}