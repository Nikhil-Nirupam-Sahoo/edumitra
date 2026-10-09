/**
 * Video API client — talks to /api/v1/video endpoints.
 */

import { API_BASE } from '../content/client';
import type {
  VideoLecture,
  VideoProgress,
  VideoDownloadManifest,
  SubtitleTrack,
  VideoLanguage,
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

/**
 * The server stores subtitles and language lists as JSON text
 * and booleans as 0/1. The client works with real arrays and
 * booleans, so the boundary normalises the row.
 */
function normalizeVideo(row: RawVideoRow): VideoLecture {
  let subtitles: SubtitleTrack[] = [];
  let languages: VideoLanguage[] = [];
  try {
    subtitles = row.subtitles_json ? JSON.parse(row.subtitles_json) : [];
  } catch {
    subtitles = [];
  }
  try {
    languages = row.languages_json ? JSON.parse(row.languages_json) : [];
  } catch {
    languages = [];
  }
  return {
    id: row.id,
    lesson_id: row.lesson_id ?? '',
    topic_id: row.topic_id ?? null,
    title: row.title,
    description: row.description ?? null,
    board_id: row.board_id,
    class_id: row.class_id,
    subject: row.subject,
    source: row.source,
    source_url: row.source_url,
    youtube_id: row.youtube_id ?? null,
    duration_sec: row.duration_sec ?? null,
    thumbnail_webp: row.thumbnail_webp ?? null,
    subtitles,
    languages,
    downloadable: !!row.downloadable,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

interface RawVideoRow {
  id: string;
  lesson_id?: string | null;
  topic_id?: string | null;
  title: string;
  description?: string | null;
  board_id: string;
  class_id: string;
  subject: string;
  source: 'youtube' | 'local' | 'diksha' | 'other';
  source_url: string;
  youtube_id?: string | null;
  duration_sec?: number | null;
  thumbnail_webp?: string | null;
  subtitles_json?: string | null;
  languages_json?: string | null;
  downloadable?: number | boolean;
  created_at: number;
  updated_at: number;
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
  const payload = await authedFetch<{ videos: RawVideoRow[]; total: number }>(
    `/video?${searchParams.toString()}`,
  );
  return { videos: payload.videos.map(normalizeVideo), total: payload.total };
}

/** Get a single video by ID. */
export async function getVideo(id: string): Promise<VideoLecture | null> {
  try {
    const row = await authedFetch<RawVideoRow>(`/video/${id}`);
    return normalizeVideo(row);
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