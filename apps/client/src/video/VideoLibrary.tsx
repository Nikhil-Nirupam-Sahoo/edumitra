/**
 * VideoLibrary — browse and search video lectures.
 *
 * Lectures are fetched from the server and filtered by the
 * student's board, class and subject. The board the student
 * picked at sign-up is the default, so the library follows
 * the board they are actually studying under.
 */

import { useCallback, useEffect, useState } from 'react';
import { listVideos } from './api';
import { createTranslator, type LocaleCode } from '../i18n';
import type { VideoLecture } from './types';

export const BOARDS = [
  { id: 'CBSE', label: 'CBSE (NCERT)' },
  { id: 'BSE_ODISHA', label: 'BSE Odisha' },
  { id: 'CHSE', label: 'CHSE Odisha' },
  { id: 'ICSE', label: 'ICSE' },
] as const;

export const SUBJECTS = [
  { id: 'math', labelKey: 'home.subject.math' },
  { id: 'science', labelKey: 'home.subject.science' },
  { id: 'sst', labelKey: 'home.subject.sst' },
  { id: 'english', labelKey: 'home.subject.english' },
] as const;

export const GRADES = ['class-8', 'class-9', 'class-10', 'class-11', 'class-12'];

interface VideoLibraryProps {
  studentId: string;
  locale: LocaleCode;
  defaultBoardId?: string | null;
  onVideoSelect: (videoId: string) => void;
}

export function VideoLibrary({
  locale,
  defaultBoardId,
  onVideoSelect,
}: VideoLibraryProps) {
  const { t } = createTranslator(locale);
  const [boardId, setBoardId] = useState<string>(defaultBoardId ?? '');
  const [subject, setSubject] = useState<string>('');
  const [grade, setGrade] = useState<string>('');
  const [query, setQuery] = useState('');
  const [videos, setVideos] = useState<VideoLecture[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listVideos({ limit: 60 });
      let list = result.videos;
      if (boardId) list = list.filter((v) => v.board_id === boardId);
      if (subject) list = list.filter((v) => v.subject === subject);
      if (grade) list = list.filter((v) => v.class_id === grade);
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        list = list.filter(
          (v) =>
            v.title.toLowerCase().includes(q) ||
            (v.description ?? '').toLowerCase().includes(q),
        );
      }
      setVideos(list);
    } catch {
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, [boardId, subject, grade, query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const shownBoardLabel = (id: string) =>
    BOARDS.find((b) => b.id === id)?.label ?? id.replace(/_/g, ' ');

  return (
    <div className="video-library">
      <div className="library-filters">
        <div className="filter-group">
          <label className="filter-label" htmlFor="board-filter">
            {t('video.board')}
          </label>
          <select
            id="board-filter"
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
          >
            <option value="">{t('video.choose_board')}</option>
            {BOARDS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label" htmlFor="subject-filter">
            {t('home.subject_all')}
          </label>
          <select
            id="subject-filter"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          >
            <option value="">{t('home.subject_all')}</option>
            {SUBJECTS.map((s) => (
              <option key={s.id} value={s.id}>
                {t(s.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label" htmlFor="grade-filter">
            {t('video.class')}
          </label>
          <select
            id="grade-filter"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
          >
            <option value="">{t('video.class')}</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g.replace('class-', '')}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group filter-search">
          <label className="filter-label" htmlFor="video-search">
            {t('video.search')}
          </label>
          <input
            id="video-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('video.search_placeholder')}
          />
        </div>
      </div>

      {loading ? (
        <div className="page-loading" aria-busy="true">
          <div className="spinner" />
          <span>{t('common.loading')}</span>
        </div>
      ) : videos.length === 0 ? (
        <p className="muted library-empty">{t('video.no_results')}</p>
      ) : (
        <ul className="video-grid">
          {videos.map((video) => (
            <li key={video.id}>
              <button
                type="button"
                className="video-card"
                onClick={() => onVideoSelect(video.id)}
              >
                <span className="video-card-thumb">
                  <img
                    src={video.thumbnail_webp ?? ''}
                    alt=""
                    loading="lazy"
                  />
                  {video.duration_sec != null && (
                    <span className="video-card-duration">
                      {Math.round(video.duration_sec / 60)}m
                    </span>
                  )}
                </span>
                <span className="video-card-body">
                  <span className="video-card-title">{video.title}</span>
                  <span className="video-card-meta">
                    {shownBoardLabel(video.board_id)} ·{' '}
                    {t(`home.subject.${video.subject}`)} ·{' '}
                    {video.class_id.replace('class-', '')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default VideoLibrary;
