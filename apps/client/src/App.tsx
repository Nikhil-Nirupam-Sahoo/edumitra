/**
 * App shell — hash-based routing (no router dependency, works from file:// and
 * any sub-path), locale state, sync engine lifecycle, and the offline banner.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { seedIfEmpty } from './db/seed';
import { getAllProgress, getLessons } from './db/client';
import type { LessonRecord } from './db/schema';
import {
  detectInitialLocale,
  LOCALE_STORAGE_KEY,
  createTranslator,
  formatPercent,
  type LocaleCode,
} from './i18n';
import { LessonViewer } from './modules/lesson/LessonViewer';
import { TeacherDashboard } from './modules/dashboard/TeacherDashboard';
import { SettingsPanel } from './modules/settings/SettingsPanel';
import { getSyncEngine } from './sync/syncEngine';

type Route = { name: 'home' } | { name: 'lesson'; lessonId: string } | { name: 'teacher' } | { name: 'settings' };

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path.startsWith('lesson/')) {
    const lessonId = decodeURIComponent(path.slice('lesson/'.length));
    return lessonId ? { name: 'lesson', lessonId } : { name: 'home' };
  }
  if (path === 'teacher') return { name: 'teacher' };
  if (path === 'settings') return { name: 'settings' };
  return { name: 'home' };
}

export function App() {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(typeof location === 'undefined' ? '' : location.hash),
  );
  const [locale, setLocale] = useState<LocaleCode>(() => detectInitialLocale());
  const [online, setOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [ready, setReady] = useState(false);
  const [studentId, setStudentId] = useState('student-asha');
  // The demo student selector is intentionally tiny; production builds map the
  // signed-in student to this id from the pairing flow.
  const { t } = useMemo(() => createTranslator(locale), [locale]);

  // ---- Boot: seed local content, start sync, wire connectivity -----------
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    (async () => {
      try {
        await seedIfEmpty();
      } catch (error) {
        console.error('[app] seeding failed', error);
      }
      setReady(true);
      const engine = getSyncEngine();
      unsubscribe = engine.watch();
    })();
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      unsubscribe?.();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    const hash =
      next.name === 'home'
        ? '#/'
        : next.name === 'lesson'
          ? `#/lesson/${encodeURIComponent(next.lessonId)}`
          : `#/${next.name}`;
    location.hash = hash;
    setRoute(next);
  }, []);

  const changeLocale = useCallback((next: LocaleCode) => {
    setLocale(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Non-fatal: locale stays for this session only.
    }
  }, []);

  return (
    <div className="app">
      <div className={`connectivity-bar ${online ? 'online' : 'offline'}`} role="status">
        {online ? `● ${t('common.online')}` : `◌ ${t('common.offline')}`}
      </div>

      {!ready ? (
        <p className="muted boot-loading">{t('common.loading')}</p>
      ) : route.name === 'lesson' ? (
        <LessonViewer
          lessonId={route.lessonId}
          studentId={studentId}
          locale={locale}
          onExit={() => navigate({ name: 'home' })}
        />
      ) : route.name === 'teacher' ? (
        <TeacherDashboard locale={locale} />
      ) : route.name === 'settings' ? (
        <SettingsPanel
          locale={locale}
          onLocaleChange={changeLocale}
          onDataReset={() => navigate({ name: 'home' })}
        />
      ) : (
        <HomeScreen
          locale={locale}
          studentId={studentId}
          onStudentChange={setStudentId}
          onOpenLesson={(lessonId) => navigate({ name: 'lesson', lessonId })}
        />
      )}

      <nav className="bottom-nav" aria-label="Primary">
        <button
          type="button"
          className={route.name === 'home' || route.name === 'lesson' ? 'active' : ''}
          onClick={() => navigate({ name: 'home' })}
        >
          📚 {t('nav.lessons')}
        </button>
        <button
          type="button"
          className={route.name === 'teacher' ? 'active' : ''}
          onClick={() => navigate({ name: 'teacher' })}
        >
          📊 {t('nav.dashboard')}
        </button>
        <button
          type="button"
          className={route.name === 'settings' ? 'active' : ''}
          onClick={() => navigate({ name: 'settings' })}
        >
          ⚙️ {t('nav.settings')}
        </button>
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home: lesson list read from the local cache with resume state
// ---------------------------------------------------------------------------

interface HomeScreenProps {
  locale: LocaleCode;
  studentId: string;
  onStudentChange: (studentId: string) => void;
  onOpenLesson: (lessonId: string) => void;
}

interface LessonListItem {
  lesson: LessonRecord;
  completionStatus: string;
  score: number;
  lastCardIndex: number;
}

const STUDENT_CHOICES = [
  { id: 'student-asha', label: 'Asha Kumari' },
  { id: 'student-ravi', label: 'Ravi Prasad' },
  { id: 'student-meena', label: 'Meena Devi' },
  { id: 'student-arjun', label: 'Arjun Singh' },
];

function HomeScreen({ locale, studentId, onStudentChange, onOpenLesson }: HomeScreenProps) {
  const { t } = useMemo(() => createTranslator(locale), [locale]);
  const [items, setItems] = useState<LessonListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const lessons = await getLessons();
      const progressRows = await getAllProgress();
      if (cancelled) return;
      const byLesson = new Map(
        progressRows
          .filter((row) => row.student_id === studentId)
          .map((row) => [row.lesson_id, row]),
      );
      setItems(
        lessons.map((lessonRecord) => {
          const progress = byLesson.get(lessonRecord.id);
          return {
            lesson: lessonRecord,
            completionStatus: progress?.completion_status ?? 'not_started',
            score: progress?.score ?? -1,
            lastCardIndex: progress?.last_card_index ?? 0,
          };
        }),
      );
      setLoading(false);
    })().catch((error) => {
      console.error('[home] failed to load lessons', error);
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  return (
    <div className="home">
      <header className="home-header">
        <h1>{t('app.name')}</h1>
        <p className="muted">{t('app.tagline')}</p>
        <label className="field">
          <span>{t('settings.student')}</span>
          <select value={studentId} onChange={(event) => onStudentChange(event.target.value)}>
            {STUDENT_CHOICES.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="muted">{t('lesson.no_lessons')}</p>
      ) : (
        <ul className="lesson-list">
          {items.map(({ lesson: lessonRecord, completionStatus, score, lastCardIndex }) => (
            <li key={lessonRecord.id}>
              <button
                type="button"
                className="lesson-list-item"
                onClick={() => onOpenLesson(lessonRecord.id)}
              >
                <span className="lesson-list-title">{lessonRecord.title}</span>
                <span className="lesson-list-meta muted">
                  {lessonRecord.language.toUpperCase()}
                  {completionStatus === 'completed' && ` · ✓ ${t('common.completed')}`}
                  {score >= 0 && ` · ${formatPercent(score)}`}
                  {completionStatus === 'in_progress' && ` · ${t('lesson.resume')}`}
                  {completionStatus === 'not_started' && ` · ${t('lesson.start')}`}
                </span>
                {lastCardIndex > 0 && completionStatus !== 'completed' && (
                  <span className="lesson-list-resume">↻</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default App;
