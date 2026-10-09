/**
 * YouTube Data API v3 service for educational video discovery.
 *
 * Two honest paths:
 *   1. With a YOUTUBE_API_KEY we call the Data API (search.list /
 *      videos.list) to discover and describe lectures at runtime.
 *   2. Without a key we fall back to oEmbed (public, keyless) for the
 *      metadata of a specific video URL we already know.
 *
 * We deliberately do NOT fabricate channel ids or video ids: every id
 * either comes from the API or from the curated seed (see video.seed.ts),
 * which pins real, verifiable lectures from NCERT, BSE Odisha, CHSE and
 * ICSE channels.
 */

import type { LoadedConfig } from '../config.js';

const YT_API = 'https://www.googleapis.com/youtube/v3';
const OEMBED_API = 'https://www.youtube.com/oembed';

/** Compressed thumbnail sizes YouTube's image server already serves. */
export type ThumbQuality = 'mqdefault' | 'hqdefault' | 'sddefault';

/**
 * Builds a compressed thumbnail URL for a YouTube video.
 * `mqdefault` (320×180) is small and fast on a classroom connection;
 * `hqdefault` is the fallback when a video has no mq frame.
 */
export function youtubeThumbnail(videoId: string, quality: ThumbQuality = 'mqdefault'): string {
  return `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;
}

/** Extracts a YouTube video id from a watch / shorts / youtu.be URL. */
export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.slice(1).split('/')[0];
      return id ? id : null;
    }
    const v = u.searchParams.get('v');
    if (v) return v;
    const shorts = u.pathname.match(/\/shorts\/([^/?]+)/);
    return shorts ? (shorts[1] ?? null) : null;
  } catch {
    return null;
  }
}

export interface VideoSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string;
  durationSec: number | null;
}

export interface VideoDetails {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  durationSec: number;
  thumbnail: string;
  captionsAvailable: boolean;
}

/** Normalise an ISO 8601 duration (PT1H2M3S) to seconds. */
export function isoDurationToSec(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] ?? '0', 10);
  const m = parseInt(match[2] ?? '0', 10);
  const s = parseInt(match[3] ?? '0', 10);
  return h * 3600 + m * 60 + s;
}

export function createYouTubeService(config: LoadedConfig) {
  const apiKey = config.youtubeApiKey;

  /**
   * Search YouTube for educational videos. Requires an API key; without
   * one it returns an empty list rather than pretending to have results.
   */
  async function searchVideos(query: string, options: {
    maxResults?: number;
    relevanceLanguage?: string;
    channelId?: string;
  } = {}): Promise<VideoSearchResult[]> {
    if (!apiKey) return [];
    const { maxResults = 12, relevanceLanguage, channelId } = options;

    const params = new URLSearchParams({
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: String(Math.min(maxResults, 50)),
      safeSearch: 'strict',
      videoEmbeddable: 'true',
      order: 'relevance',
      ...(relevanceLanguage ? { relevanceLanguage } : {}),
      ...(channelId ? { channelId } : {}),
      key: apiKey,
    });

    const response = await fetch(`${YT_API}/search?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      items?: Array<{
        id?: { videoId?: string };
        snippet?: { title: string; channelTitle: string; publishedAt: string; thumbnails?: { medium?: { url: string } } };
      }>;
    };
    return (payload.items ?? [])
      .filter((item) => item.id?.videoId)
      .map((item) => ({
        videoId: item.id!.videoId!,
        title: item.snippet?.title ?? 'Untitled',
        channelTitle: item.snippet?.channelTitle ?? '',
        publishedAt: item.snippet?.publishedAt ?? '',
        thumbnail: item.snippet?.thumbnails?.medium?.url ?? youtubeThumbnail(item.id!.videoId!),
        durationSec: null,
      }));
  }

  /**
   * Fetch full details (including duration and caption availability) for
   * a batch of video ids. Requires an API key.
   */
  async function fetchDetails(videoIds: string[]): Promise<VideoDetails[]> {
    if (!apiKey || videoIds.length === 0) return [];
    const params = new URLSearchParams({
      part: 'snippet,contentDetails',
      id: videoIds.slice(0, 50).join(','),
      key: apiKey,
    });
    const response = await fetch(`${YT_API}/videos?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      items?: Array<{
        id: string;
        snippet: { title: string; description: string; channelTitle: string; publishedAt: string; thumbnails?: { medium?: { url: string } } };
        contentDetails: { duration: string; caption: string };
      }>;
    };
    return (payload.items ?? []).map((item) => ({
      videoId: item.id,
      title: item.snippet?.title ?? 'Untitled',
      description: item.snippet?.description ?? '',
      channelTitle: item.snippet?.channelTitle ?? '',
      publishedAt: item.snippet?.publishedAt ?? '',
      durationSec: isoDurationToSec(item.contentDetails?.duration ?? ''),
      thumbnail: item.snippet?.thumbnails?.medium?.url ?? youtubeThumbnail(item.id),
      captionsAvailable: item.contentDetails?.caption === 'true',
    }));
  }

  /**
   * Public, keyless metadata for a single video URL via oEmbed.
   * Returns null when the video is unavailable or private.
   */
  async function fetchOEmbed(url: string): Promise<{
    title: string;
    authorName: string;
    thumbnail: string;
    html: string;
  } | null> {
    try {
      const response = await fetch(
        `${OEMBED_API}?url=${encodeURIComponent(url)}&format=json`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) return null;
      const data = (await response.json()) as {
        title: string;
        author_name: string;
        thumbnail_url: string;
        html: string;
      };
      return {
        title: data.title,
        authorName: data.author_name,
        thumbnail: data.thumbnail_url,
        html: data.html,
      };
    } catch {
      return null;
    }
  }

  return { searchVideos, fetchDetails, fetchOEmbed };
}

export type YouTubeService = ReturnType<typeof createYouTubeService>;
