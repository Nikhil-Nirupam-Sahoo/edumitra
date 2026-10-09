/**
 * Video types shared between client and server.
 */

export interface SubtitleTrack {
  lang: string;
  label: string;
  url: string;
  format: 'vtt' | 'srt';
  color?: string;
  background?: string;
}

export interface VideoLanguage {
  code: string;
  label: string;
}

export interface VideoLecture {
  id: string;
  lesson_id: string;
  topic_id: string | null;
  title: string;
  description: string | null;
  board_id: string;
  class_id: string;
  subject: string;
  source: 'youtube' | 'local' | 'diksha' | 'other';
  source_url: string;
  youtube_id: string | null;
  duration_sec: number | null;
  thumbnail_webp: string | null;
  subtitles: SubtitleTrack[];
  languages: VideoLanguage[];
  downloadable: boolean;
  created_at: number;
  updated_at: number;
}

export interface VideoProgress {
  student_id: string;
  video_id: string;
  position_sec: number;
  completed: boolean;
  playback_speed: number;
  subtitle_lang: string | null;
  subtitle_color: string | null;
  subtitle_bg: string | null;
  last_watched_at: number;
}

export interface VideoDownloadManifest {
  video_id: string;
  title: string;
  source_url: string;
  youtube_id: string | null;
  quality: '360p' | '480p' | '720p';
  subtitles: SubtitleTrack[];
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
  style?: {
    color?: string;
    background?: string;
  };
}

/** Parsed VTT cue with timing and styling. */
export interface ParsedVTTCue {
  startTime: number;
  endTime: number;
  text: string;
  style?: {
    color?: string;
    background?: string;
  };
}