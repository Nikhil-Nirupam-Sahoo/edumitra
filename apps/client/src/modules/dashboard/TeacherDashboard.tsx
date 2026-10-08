/**
 * TeacherDashboard — fully offline class analytics.
 *
 * Reads exclusively from the local IndexedDB cache (student_progress,
 * students, attendance) via `db/queries.ts`. No network calls, ever.
 *
 * Layout is optimized for a teacher's low-end phone: a compact KPI strip, then
 * a "needs support" list, then a windowed student table (renders at most 25
 * rows at a time to bound memory/DOM cost), plus a "Class Champions" leaderboard.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getStrugglingStudents, listClasses, type ClassSummary, type StudentSummary } from '../../db/queries';
import { getClassSummary } from '../../db/queries';
import { getAllXpEvents } from '../../db/client';
import { deriveGamification } from '../../gamification/engine';
import { formatDurationShort, formatPercent, createTranslator, type LocaleCode } from '../../i18n';
import type { StudentRecord } from '../../db/schema';

const WINDOW_SIZE = 25;

export interface TeacherDashboardProps {
  locale: LocaleCode;
  /** Optional preselected class. */
  initialClassId?: string;
  /** Refresh cadence in ms; defaults to 30 s while mounted. */
  refreshMs?: number;
  now?: () => number;
  /** All students (for class filter + leaderboard). */
  students?: StudentRecord[];
}

interface DashboardState {
  status: 'loading' | 'ready' | 'empty' | 'error';
  classes: string[];
  classId: string | null;
  summary: ClassSummary | null;
  struggling: StudentSummary[];
  error?: string;
}

export function TeacherDashboard({
  locale,
  initialClassId,
  refreshMs = 30_000,
  now = () => Date.now(),
  students = [],
}: TeacherDashboardProps) {
  const { t } = useMemo(() => createTranslator(locale), [locale]);
  const [state, setState] = useState<DashboardState>({
    status: 'loading',
    classes: [],
    classId: initialClassId ?? null,
    summary: null,
    struggling: [],
  });
  const [visibleCount, setVisibleCount] = useState(WINDOW_SIZE);
  const [champions, setChampions] = useState<Array<{ id: string; name: string; weekXp: number; level: number }>>([]);

  const refresh = useCallback(
    async (classId?: string | null) => {
      try {
        const classes = await listClasses();
        const target = classId ?? (classes.length > 0 ? classes[0]! : null);
        if (!target) {
          setState({
            status: 'empty',
            classes,
            classId: null,
            summary: null,
            struggling: [],
          });
          return;
        }
        const referenceNow = now();
        const [summary, struggling] = await Promise.all([
          getClassSummary(target, { now: referenceNow }),
          getStrugglingStudents(target, 10, { now: referenceNow }),
        ]);
        setState({
          status: 'ready',
          classes,
          classId: target,
          summary,
          struggling,
        });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [now],
  );

  // Load class champions (weekly XP leaderboard)
  const refreshChampions = useCallback(async (classId: string) => {
    const classStudents = students.filter((s) => s.class_id === classId);
    if (classStudents.length === 0) {
      setChampions([]);
      return;
    }
    const allEvents = await getAllXpEvents();
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const leaderboard = classStudents
      .map((peer) => {
        const peerEvents = allEvents.filter((e) => e.student_id === peer.id && e.created_at >= weekAgo);
        const peerState = deriveGamification(peerEvents, Date.now());
        return { id: peer.id, name: peer.name, weekXp: peerState.weekXp, level: peerState.level };
      })
      .sort((a, b) => b.weekXp - a.weekXp)
      .slice(0, 5);
    setChampions(leaderboard);
  }, [students]);

  useEffect(() => {
    void refresh(initialClassId ?? null);
  }, [refresh, initialClassId]);

  useEffect(() => {
    if (state.classId) void refreshChampions(state.classId);
  }, [refreshChampions, state.classId]);

  useEffect(() => {
    if (refreshMs <= 0) return;
    const timer = setInterval(() => void refresh(state.classId), refreshMs);
    return () => clearInterval(timer);
  }, [refresh, refreshMs, state.classId]);

  const selectClass = useCallback(
    (classId: string) => {
      setVisibleCount(WINDOW_SIZE);
      void refresh(classId);
    },
    [refresh],
  );

  if (state.status === 'loading') {
    return (
      <div className="dashboard" aria-busy="true">
        <p className="muted">{t('common.loading')}</p>
      </div>
    );
  }

  if (state.status === 'empty') {
    return (
      <div className="dashboard" role="status">
        <h1>{t('dashboard.title')}</h1>
        <p className="muted">{t('dashboard.no_data')}</p>
      </div>
    );
  }

  if (state.status === 'error' || !state.summary) {
    return (
      <div className="dashboard" role="alert">
        <h1>{t('dashboard.title')}</h1>
        <p className="error">{state.error ?? t('dashboard.no_data')}</p>
        <button type="button" className="btn btn-secondary" onClick={() => void refresh()}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const { summary } = state;
  const visibleStudents = summary.students.slice(0, visibleCount);

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>{t('dashboard.title')}</h1>
        {state.classes.length > 1 && (
          <label className="class-picker">
            <span className="sr-only">{t('dashboard.class')}</span>
            <select
              value={state.classId ?? ''}
              onChange={(event) => selectClass(event.target.value)}
            >
              {state.classes.map((classId) => (
                <option key={classId} value={classId}>
                  {classId}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <section className="kpi-strip" aria-label={t('dashboard.title')}>
        <Kpi label={t('dashboard.students')} value={String(summary.totalStudents)} />
        <Kpi
          label={t('dashboard.avg_completion')}
          value={formatPercent(summary.averageCompletion)}
        />
        <Kpi label={t('dashboard.avg_score')} value={formatPercent(summary.averageScore)} />
        <Kpi label={t('dashboard.active_today')} value={String(summary.activeToday)} />
        <Kpi
          label={t('dashboard.struggling')}
          value={String(summary.strugglingCount)}
          tone={summary.strugglingCount > 0 ? 'warn' : 'ok'}
        />
        <Kpi
          label={t('dashboard.time_on_task')}
          value={formatDurationShort(summary.totalTimeOnTaskMs, locale)}
        />
      </section>

      {state.struggling.length > 0 && (
        <section className="panel" aria-label={t('dashboard.struggling')}>
          <h2>{t('dashboard.struggling')}</h2>
          <ul className="struggling-list">
            {state.struggling.map((student) => (
              <li key={student.student.id} className="struggling-item">
                <span className="student-name">{student.student.name}</span>
                <span className="student-stats">
                  {formatPercent(student.averageScore)} · {student.lessonsCompleted}/
                  {student.lessonsStarted}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel" aria-label={t('dashboard.attendance')}>
        <h2>{t('dashboard.attendance')}</h2>
        <p className="muted">
          {t('dashboard.present')}: {summary.presentToday} / {summary.totalStudents} ·{' '}
          {summary.day}
        </p>
      </section>

      <section className="panel" aria-label={t('dashboard.students')}>
        <h2>{t('dashboard.students')}</h2>
        <table className="student-table">
          <thead>
            <tr>
              <th scope="col">{t('dashboard.students')}</th>
              <th scope="col">{t('common.progress')}</th>
              <th scope="col">{t('common.score')}</th>
              <th scope="col">{t('dashboard.time_on_task')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleStudents.map((student) => (
              <StudentRow key={student.student.id} student={student} />
            ))}
          </tbody>
        </table>
        {visibleCount < summary.students.length && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setVisibleCount((count) => count + WINDOW_SIZE)}
          >
            {t('common.next')} (+{Math.min(WINDOW_SIZE, summary.students.length - visibleCount)})
          </button>
        )}
      </section>

      {/* Class Champions leaderboard (weekly XP) */}
      <section className="panel" aria-label={t('dashboard.champions')}>
        <h2>{t('dashboard.champions')}</h2>
        <ol className="leaderboard-list">
          {champions.map((champ, i) => (
            <li key={champ.id} className="leaderboard-item">
              <span className="leaderboard-rank">{i + 1}</span>
              <span className="leaderboard-name">{champ.name}</span>
              <span className="leaderboard-xp">{champ.weekXp} XP · L{champ.level}</span>
            </li>
          ))}
        </ol>
        {champions.length === 0 && <p className="muted">{t('dashboard.no_data')}</p>}
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'warn' | 'ok';
}) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}

function StudentRow({ student }: { student: StudentSummary }) {
  const statusClass = student.struggling
    ? 'row-warning'
    : student.lessonsCompleted > 0
      ? 'row-ok'
      : '';
  return (
    <tr className={statusClass}>
      <td>
        {student.student.name}
        {student.activeToday && <span aria-hidden="true"> ●</span>}
      </td>
      <td>{formatPercent(student.completionRatio)}</td>
      <td>{student.lessonsStarted > 0 ? formatPercent(student.averageScore) : '—'}</td>
      <td>{formatDurationShort(student.totalTimeOnTaskMs)}</td>
    </tr>
  );
}

export default TeacherDashboard;
