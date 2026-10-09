/**
 * StudentDetail — drill-down analytics for one student.
 *
 * Opened from a name in the dashboard. Answers the questions a teacher has
 * about an individual: which subject is the problem, are they improving, are
 * they still turning up, and which chapters to reteach next week.
 *
 * All of it is computed from the local cache, so it works with no connection.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getClassMastery,
  getStudentAnalytics,
  type ChapterResult,
  type StudentAnalytics,
} from '../../db/analytics';
import { createTranslator, formatDurationShort, formatPercent, type LocaleCode } from '../../i18n';
import {
  ActivityHeatmap,
  BarChart,
  LineChart,
  RadarChart,
  StatTile,
  type Point,
} from '../../charts/Charts';

export function StudentDetail({
  studentId,
  locale,
  onClose,
}: {
  studentId: string;
  locale: LocaleCode;
  onClose: () => void;
}) {
  const { t } = createTranslator(locale);
  const [data, setData] = useState<StudentAnalytics | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');

  const load = useCallback(async () => {
    setStatus('loading');
    const result = await getStudentAnalytics(studentId);
    setData(result);
    setStatus(result ? 'ready' : 'missing');
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === 'loading') {
    return (
      <div className="panel" aria-busy="true">
        <p className="muted">{t('common.loading')}</p>
      </div>
    );
  }

  if (status === 'missing' || !data) {
    return (
      <div className="panel" role="alert">
        <p>{t('dashboard.no_data')}</p>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    );
  }

  const inactivity =
    data.daysSinceActivity === null
      ? t('dashboard.never_active')
      : data.daysSinceActivity === 0
        ? t('rewards.streak_today')
        : t('dashboard.days_since_active', { count: data.daysSinceActivity });

  return (
    <section className="panel student-detail" aria-label={data.name}>
      <header className="student-detail-head">
        <h2>{data.name}</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          ✕ {t('common.close')}
        </button>
      </header>

      <p className="muted student-detail-meta">
        {data.classId.replace('class-', 'Class ')} · {inactivity}
      </p>

      <div className="stat-row">
        <StatTile label={t('common.score')} value={formatPercent(data.averageScore)} />
        <StatTile
          label={t('common.progress')}
          value={formatPercent(data.completionRatio)}
          hint={`${data.lessonsCompleted}/${data.lessonsStarted}`}
        />
        <StatTile
          label={t('dashboard.time_on_task')}
          value={formatDurationShort(data.totalTimeOnTaskMs, locale)}
        />
        <StatTile label={t('rewards.xp', { xp: '' }).replace(' XP', '')} value={data.totalXp} trend={data.xpTrend} />
      </div>

      {data.lessonsStarted === 0 ? (
        <p className="muted">{t('dashboard.no_data')}</p>
      ) : (
        <>
          {data.scoreTrend.length > 1 && (
            <figure className="chart-block">
              <h3>{t('dashboard.progress_over_time')}</h3>
              <LineChart
                labels={data.scoreTrend.map((p) => p.label)}
                series={[{ name: t('common.score'), points: data.scoreTrend.map((p) => p.value) }]}
                caption={`${data.name}: ${t('dashboard.progress_over_time')}`}
              />
            </figure>
          )}

          {data.masteryBySubject.length >= 3 && (
            <figure className="chart-block">
              <h3>{t('dashboard.subject_shape')}</h3>
              <RadarChart
                axes={data.masteryBySubject.map((s) => ({ label: s.label, value: s.mastery }))}
                caption={`${data.name}: ${t('dashboard.subject_shape')}`}
              />
            </figure>
          )}

          {data.masteryBySubject.length > 0 && (
            <figure className="chart-block">
              <h3>{t('dashboard.subject_mastery')}</h3>
              <BarChart
                points={data.masteryBySubject.map((s) => ({ label: s.label, value: s.mastery }))}
                caption={`${data.name}: ${t('dashboard.subject_mastery')}`}
              />
            </figure>
          )}

          <figure className="chart-block">
            <h3>{t('dashboard.activity')}</h3>
            <ActivityHeatmap
              days={data.activity}
              caption={`${data.name}: ${t('dashboard.activity')}`}
            />
          </figure>

          <ChapterList
            title={t('dashboard.weakest_chapters')}
            empty={t('dashboard.no_weak_chapters')}
            chapters={data.weakestChapters}
            tone="warn"
          />
          <ChapterList
            title={t('dashboard.strongest_chapters')}
            empty={t('dashboard.no_strong_chapters')}
            chapters={data.strongestChapters}
            tone="ok"
          />
        </>
      )}
    </section>
  );
}

/**
 * Class-level mastery by subject — the one chart that tells a teacher whether a
 * gap belongs to a student or to how the chapter was taught.
 */
export function ClassMasteryChart({ classId }: { classId: string }) {
  const { t } = createTranslator('en');
  const [points, setPoints] = useState<Point[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getClassMastery(classId)
      .then((rows) => {
        if (cancelled) return;
        setPoints(rows.map((r) => ({ label: r.label, value: r.mastery })));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  if (!loaded) return null;
  if (points.length === 0) return null;

  return (
    <section className="panel" aria-label={t('dashboard.subject_mastery')}>
      <h2>{t('dashboard.subject_mastery')}</h2>
      <BarChart
        points={points}
        caption={`${t('dashboard.title')} — ${t('dashboard.subject_mastery')}`}
      />
    </section>
  );
}

function ChapterList({
  title,
  empty,
  chapters,
  tone,
}: {
  title: string;
  empty: string;
  chapters: ChapterResult[];
  tone: 'warn' | 'ok';
}) {
  return (
    <div className="chart-block">
      <h3>{title}</h3>
      {chapters.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ol className={`chapter-list chapter-list--${tone}`}>
          {chapters.map((c) => (
            <li key={c.lessonId} className="chapter-row">
              <span className="chapter-title">{c.title}</span>
              <span className="chapter-score">{formatPercent(c.score)}</span>
              <span className={`chapter-flag ${c.completed ? 'done' : 'open'}`}>
                {c.completed ? '✓' : '→'}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}