/**
 * App shell — hash-based routing (no router dependency, works from file:// and
 * any sub-path), locale state, sync engine lifecycle, and the offline banner.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { bootstrap } from './db/seed';
import { getAllStudents } from './db/client';
import type { StudentRecord } from './db/schema';
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
import { HomeScreen } from './modules/home/HomeScreen';
import { restoreRemoteLocales } from './i18n/remote';
import { RewardsPanel } from './modules/rewards/RewardsPanel';
import { resetGamificationStore } from './gamification/store';

type Route =
  | { name: 'home' }
  | { name: 'lesson'; lessonId: string }
  | { name: 'teacher' }
  | { name: 'settings' }
  | { name: 'rewards' };

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path.startsWith('lesson/')) {
    const lessonId = decodeURIComponent(path.slice('lesson/'.length));
    return lessonId ? { name: 'lesson', lessonId } : { name: 'home' };
  }
  if (path === 'teacher') return { name: 'teacher' };
  if (path === 'settings') return { name: 'settings' };
  if (path === 'rewards') return { name: 'rewards' };
  return { name: 'home' };
}

function classIdToGrade(classId: string): number | null {
  const m = classId.match(/class-(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function App() {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(typeof location === 'undefined' ? '' : location.hash),
  );
  const [locale, setLocale] = useState<LocaleCode>(() => {
    // Restore cached live-translations BEFORE reading the stored locale, so a
    // previously translated language resolves instead of falling back to "en".
    restoreRemoteLocales();
    return detectInitialLocale();
  });
  const [online, setOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [ready, setReady] = useState(false);
  const [studentId, setStudentId] = useState('student-aarav');
  const { t } = useMemo(() => createTranslator(locale), [locale]);

  /**
   * `navigator.onLine` only reports "is there a network interface" — it lies
   * on captive portals, dead Wi-Fi and some mobile networks, which is why the
   * app used to claim to be offline while sitting on a working connection.
   * Treat the device as online if EITHER the browser says so OR a real request
   * to our own health endpoint succeeds; only a confirmed failure plus a
   * reported-down interface marks us offline.
   */
  const probeConnectivity = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setOnline(false);
      return;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const response = await fetch('/api/v1/health', {
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timer);
      setOnline(response.ok);
    } catch {
      // Probe failed. Keep the optimistic "online" view unless the browser
      // explicitly reports no network — the app is fully usable offline
      // either way, so an alarming banner would be misleading.
      if (typeof navigator === 'undefined' || navigator.onLine) setOnline(true);
    }
  }, []);

  // ---- Boot: fetch the curriculum, start sync, wire connectivity ----------
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    (async () => {
      try {
        const result = await bootstrap();
        if (result.contentUnavailable) {
          console.warn('[app] no lessons available yet — needs a connection once');
        }
      } catch (error) {
        console.error('[app] bootstrap failed', error);
      }
      setReady(true);
      const engine = getSyncEngine();
      unsubscribe = engine.watch();
    })();
    const onOnline = () => void probeConnectivity();
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    void probeConnectivity();
    const poll = window.setInterval(() => void probeConnectivity(), 60_000);
    return () => {
      unsubscribe?.();
      window.clearInterval(poll);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [probeConnectivity]);

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

  // Load students for RewardsPanel leaderboard class filtering
  const [students, setStudents] = useState<StudentRecord[]>([]);
  useEffect(() => {
    let cancelled = false;
    getAllStudents().then((s) => {
      if (!cancelled) setStudents(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Find current student's class
  const currentStudent = students.find((s) => s.id === studentId);
  const currentClassId = currentStudent?.class_id ?? 'class-8-a';

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
        <TeacherDashboard locale={locale} students={students} />
      ) : route.name === 'settings' ? (
        <SettingsPanel
          locale={locale}
          onLocaleChange={changeLocale}
          onDataReset={() => {
            resetGamificationStore();
            navigate({ name: 'home' });
          }}
        />
      ) : route.name === 'rewards' ? (
        <RewardsPanel
          studentId={studentId}
          studentName={currentStudent?.name ?? 'Student'}
          locale={locale}
          classId={currentClassId}
          onClose={() => navigate({ name: 'home' })}
        />
      ) : (
        <HomeScreen
          locale={locale}
          studentId={studentId}
          studentName={currentStudent?.name ?? 'Student'}
          classId={currentClassId}
          onLessonSelect={(lessonId) => navigate({ name: 'lesson', lessonId })}
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
          className={route.name === 'rewards' ? 'active' : ''}
          onClick={() => navigate({ name: 'rewards' })}
        >
          🏆 {t('nav.rewards')}
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

export default App;