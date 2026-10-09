/**
 * VideoLecturePage — the full page for watching a lecture.
 *
 * Shows the player, the lecture's metadata (board, class,
 * subject, source, duration) and a rail of related lectures.
 * Content is fetched from the server, never bundled.
 */

import { useEffect, useState } from 'react';
import { VideoPlayer } from './VideoPlayer';
import { getVideo, listVideos } from './api';
import { createTranslator, type LocaleCode } from '../i18n';
import type { VideoLecture } from './types';

interface VideoLecturePageProps {
  videoId: string;
  studentId: string;
  locale: LocaleCode;
  onExit: () => void;
  onVideoSelect?: (videoId: string) => void;
}

export function VideoLecturePage({
  videoId,
  studentId,
  locale,
  onExit,
  onVideoSelect,
}: VideoLecturePageProps) {
  const { t } = createTranslator(locale);
  const [video, setVideo] = useState<VideoLecture | null>(null);
  const [related, setRelated] = useState<VideoLecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [data, rail] = await Promise.all([
          getVideo(videoId),
          listVideos({ limit: 12 }),
        ]);
        if (cancelled) return;
        if (!data) {
          setError(t('video.no_results'));
          return;
        }
        setVideo(data);
        setRelated(
          rail.videos
            .filter(
              (v) =>
                v.id !== videoId &&
                (v.board_id === data.board_id || v.subject === data.subject),
            )
            .slice(0, 8),
        );
      } catch {
        if (!cancelled) setError(t('video.no_results'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [videoId, t]);

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
          <h2>{t('video.no_results')}</h2>
          <p>{error}</p>
          <button type="button" className="btn btn-primary" onClick={onExit}>
            ← {t('nav.back')}
          </button>
        </div>
      </div>
    );
  }

  const minutes = video.duration_sec
    ? Math.round(video.duration_sec / 60)
    : null;

  return (
    <div className="video-lecture-page">
      <header className="video-page-header">
        <button type="button" className="btn btn-ghost header-back" onClick={onExit}>
          ← {t('nav.back')}
        </button>
        <h1 className="video-title">{video.title}</h1>
        <div className="video-meta">
          <span className="video-chip">{t(`home.subject.${video.subject}`)}</span>
          <span className="video-chip">
            {t('video.class')}: {video.class_id.replace('class-', '')}
          </span>
          <span className="video-chip">
            {t('video.board')}: {video.board_id.replace(/_/g, ' ')}
          </span>
          {minutes !== null && (
            <span className="video-chip">
              {t('video.duration')}: {minutes}m
            </span>
          )}
          <span className="video-chip video-source">
            {t('video.source')}: {video.source === 'youtube' ? 'YouTube' : 'EduMitra'}
          </span>
        </div>
      </header>

      <main className="video-page-main">
        <div className="video-main-content">
          <VideoPlayer
            video={video}
            studentId={studentId}
            locale={locale}
          />

          <section className="video-description" aria-labelledby="about-heading">
            <h2 id="about-heading">{t('video.about')}</h2>
            <div className="description-content">
              {video.description ? (
                <p>{video.description}</p>
              ) : (
                <p className="muted">{t('video.no_description')}</p>
              )}
            </div>
          </section>
        </div>

        <aside className="video-sidebar" aria-label={t('video.related_videos')}>
          <h2 className="sidebar-title">{t('video.related_videos')}</h2>
          {related.length === 0 ? (
            <p className="muted">{t('video.no_related')}</p>
          ) : (
            <ul className="related-video-list">
              {related.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className="related-video-link"
                    onClick={() => onVideoSelect?.(v.id)}
                  >
                    <img
                      src={v.thumbnail_webp ?? ''}
                      alt=""
                      className="related-thumbnail"
                      loading="lazy"
                    />
                    <span className="related-info">
                      <span className="related-title">{v.title}</span>
                      <span className="related-meta">
                        {t(`home.subject.${v.subject}`)}
                        {v.duration_sec != null &&
                          ` · ${Math.round(v.duration_sec / 60)}m`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </main>
    </div>
  );
}

export default VideoLecturePage;
