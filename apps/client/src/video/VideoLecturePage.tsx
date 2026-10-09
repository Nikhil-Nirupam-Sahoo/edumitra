/**
 * VideoLecturePage — the full page for watching a video lecture.
 *
 * Includes the VideoPlayer, related videos sidebar, description,
 * and integration with the lesson flow.
 */

import { useCallback, useEffect, useState } from 'react';
import { VideoPlayer } from './VideoPlayer';
import { listVideos, getVideo } from '../video/api';
import { createTranslator, type LocaleCode } from '../i18n';
import type { VideoLecture } from './types';

interface VideoLecturePageProps {
  videoId: string;
  studentId: string;
  locale: LocaleCode;
  onExit: () => void;
  onLessonSelect?: (lessonId: string) => void;
}

export function VideoLecturePage({ videoId, studentId, locale, onExit, onLessonSelect }: VideoLecturePageProps) {
  const { t } = createTranslator(locale);
  const [video, setVideo] = useState<VideoLecture | null>(null);
  const [relatedVideos, setRelatedVideos] = useState<VideoLecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [videoData, related] = await Promise.all([
          getVideo(videoId),
          listVideos({ limit: 10 }),
        ]);
        if (cancelled) return;
        if (!videoData) {
          setError('Video not found');
          return;
        }
        setVideo(videoData);
        // Filter related videos (same subject/board, exclude current)
        const filtered = related.videos
          .filter(v => v.id !== videoId)
          .slice(0, 8);
        setRelatedVideos(filtered);
      } catch (err) {
        if (!cancelled) setError('Failed to load video');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [videoId]);

  if (loading) {
    return (
      <div className="video-lecture-page" aria-busy="true">
        <div className="page-loading">
          <div className="spinner" />
          <span>{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="video-lecture-page" role="alert">
        <div className="error-state">
          <h2>{t('common.error')}</h2>
          <p>{error || t('common.retry')}</p>
          <button className="btn btn-primary" onClick={onExit}>
            ← {t('nav.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="video-lecture-page">
      <header className="video-page-header">
        <button className="btn btn-ghost header-back" onClick={onExit}>
          ← {t('nav.back')}
        </button>
        <h1 className="video-title">{video.title}</h1>
        <div className="video-meta">
          <span className="video-subject">{t(`home.subject.${video.subject}`)}</span>
          <span className="video-class">{t('home.tab_class', { grade: video.class_id })}</span>
          <span className="video-board">{video.board_id}</span>
        </div>
      </header>

      <main className="video-page-main">
        <div className="video-main-content">
          <VideoPlayer
            video={video}
            studentId={studentId}
            onProgress={() => { /* progress tracked globally */ }}
          />
          
          <section className="video-description" aria-labelledby="desc-heading">
            <h2 id="desc-heading">{t('video.description')}</h2>
            <div className="description-content">
              {video.description || <p className="muted">{t('video.no_description')}</p>}
            </div>
          </section>

          {video.subtitles.length > 0 && (
            <section className="subtitle-options" aria-labelledby="sub-heading">
              <h2 id="sub-heading">{t('video.subtitles')}</h2>
              <div className="subtitle-list">
                {video.subtitles.map(s => (
                  <button
                    key={s.lang}
                    className="subtitle-option"
                    onClick={() => { /* subtitle change handled by VideoPlayer */ }}
                  >
                    <span className="subtitle-flag">{getFlag(s.lang)}</span>
                    <span className="subtitle-label">{s.label}</span>
                    <span className="subtitle-format">{s.format.toUpperCase()}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {video.languages.length > 1 && (
            <section className="audio-languages" aria-labelledby="audio-heading">
              <h2 id="audio-heading">{t('video.audio_languages')}</h2>
              <div className="language-pills">
                {video.languages.map(l => (
                  <button key={l.code} className="language-pill">
                    {l.label}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="video-sidebar" aria-label={t('video.related')}>
          <h2 className="sidebar-title">{t('video.related_videos')}</h2>
          {relatedVideos.length === 0 ? (
            <p className="muted">{t('video.no_related')}</p>
          ) : (
            <ul className="related-video-list">
              {relatedVideos.map(v => (
                <li key={v.id} className="related-video-item">
                  <button
                    className="related-video-link"
                    onClick={() => onLessonSelect?.(v.lesson_id ?? '')}
                  >
                    <img
                      src={v.thumbnail_webp || ''}
                      alt=""
                      className="related-thumbnail"
                      loading="lazy"
                    />
                    <div className="related-info">
                      <h3 className="related-title">{v.title}</h3>
                      <div className="related-meta">
                        <span className="related-subject">{t(`home.subject.${v.subject}`)}</span>
                        <span className="related-duration">{formatDuration(v.duration_sec)}</span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </main>

      <footer className="video-page-footer">
        <button className="btn btn-secondary" onClick={onExit}>
          ← {t('nav.back')}
        </button>
        <div className="footer-actions">
          <button className="btn btn-primary download-all">
            ⬇ {t('video.download_all')}
          </button>
        </div>
      </footer>
    </div>
  );
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getFlag(lang: string): string {
  const flags: Record<string, string> = {
    en: '🇺🇸', hi: '🇮🇳', ta: '🇮🇳', or: '🇮🇳',
    bn: '🇧🇩', mr: '🇮🇳', gu: '🇮🇳', kn: '🇮🇳',
    ml: '🇮🇳', te: '🇮🇳', pa: '🇮🇳', ur: '🇮🇳',
  };
  return flags[lang] || '🌐';
}

export default VideoLecturePage;