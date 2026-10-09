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
import { VideoLecturePage } from './video/VideoLecturePage';
import { VideoLibrary } from './video/VideoLibrary';
import { getSyncEngine } from './sync/syncEngine';
import { applyFontScale, loadFontScale } from './appearance';
import { HomeScreen } from './modules/home/HomeScreen';
import { restoreRemoteLocales } from './i18n/remote';
import { useAuth } from './auth/client';
import { LoginScreen } from './auth/LoginScreen';
import { SessionBar } from './auth/SessionBar';
import { RewardsPanel } from './modules/rewards/RewardsPanel';
import { QuizArena } from './modules/games/QuizArena';
import { Reels } from './modules/reels/Reels';
import { SupportPanel } from './modules/support/SupportPanel';
import { resetGamificationStore } from './gamification/store';

type Route =
  | { name: 'home' }
  | { name: 'lesson'; lessonId: string }
  | { name: 'videos' }
  | { name: 'video'; videoId: string }
  | { name: 'teacher' }
  | { name: 'settings' }
  | { name: 'rewards' }
  | { name: 'games' }
  | { name: 'reels' }
  | { name: 'support' };

/** Hash → route. Exported for tests; the shell is the only caller. */
export function parseRoute(hash: string): Route {
  // Trailing slashes are common from hand-typed URLs; without this, a lesson id
  // would keep its slash and the lesson would not be found.
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  if (path.startsWith('lesson/')) {
    const lessonId = decodeURIComponent(path.slice('lesson/'.length));
    return lessonId ? { name: 'lesson', lessonId } : { name: 'home' };
  }
  if (path === 'videos') return { name: 'videos' };
  if (path.startsWith('video/')) {
    const videoId = decodeURIComponent(path.slice('video/'.length));
    return videoId ? { name: 'video', videoId } : { name: 'videos' };
  }
  if (path === 'teacher') return { name: 'teacher' };
  if (path === 'settings') return { name: 'settings' };
  if (path === 'rewards') return { name: 'rewards' };
  if (path === 'games') return { name: 'games' };
  if (path === 'reels') return { name: 'reels' };
  if (path === 'support') return { name: 'support' };
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
  const auth = useAuth();
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
          : next.name === 'video'
            ? `#/video/${encodeURIComponent(next.videoId)}`
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

  // ---- Appearance: text size ------------------------------------------
  // Applied to the device immediately (works offline) and mirrored to the
  // profile when a session exists, so the setting follows the student to
  // every device they sign in on.
  const [fontScale, setFontScale] = useState<number>(() => loadFontScale());

  useEffect(() => {
    applyFontScale(fontScale);
  }, [fontScale]);

  // When a session is confirmed, the server's saved size wins.
  useEffect(() => {
    if (auth.state.status === 'signed-in' && typeof auth.state.user.fontSize === 'number') {
      setFontScale(auth.state.user.fontSize);
    }
  }, [auth.state]);

  const handleFontSizeChange = useCallback(
    (scale: number) => {
      setFontScale(scale);
      if (auth.state.status === 'signed-in') {
        void auth.updateProfile({ fontSize: scale }).catch(() => {
          /* offline — the on-device value above already applies */
        });
      }
    },
    [auth],
  );

  const handleAvatarChange = useCallback(
    (dataUrl: string | null) => {
      if (auth.state.status === 'signed-in') {
        void auth.updateProfile({ avatarUrl: dataUrl }).catch(() => {
          /* offline — try again next session */
        });
      }
    },
    [auth],
  );

  const currentFontScale = useMemo(() => {
    if (auth.state.status !== 'signed-in') return fontScale;
    const saved = auth.state.user.fontSize;
    return typeof saved === 'number' ? saved : fontScale;
  }, [auth.state, fontScale]);

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
  // Grade number for the tutor prompt ("Class 8"), null for non-standard classes.
  const currentGrade = classIdToGrade(currentClassId);

  // ---- Roles -------------------------------------------------------------
  // A teacher lands on the class dashboard; a student learns. The active
  // student id follows whoever is signed in, so a student's own progress and
  // gamification are the ones shown.
  const signedInStudentId = auth.state.status === 'signed-in' ? auth.state.user.id : studentId;

  const visibleRoutes = useMemo<Route['name'][]>(() => {
    if (!auth.isTeacher) {
      return ['home', 'lesson', 'videos', 'video', 'games', 'reels', 'rewards', 'support', 'settings'];
    }
    return ['teacher', 'settings'];
  }, [auth.isTeacher]);

  useEffect(() => {
    // Keep the URL honest: a student who deep-links to the dashboard is sent home.
    if (auth.state.status === 'signed-in' && !visibleRoutes.includes(route.name)) {
      navigate(auth.isTeacher ? { name: 'teacher' } : { name: 'home' });
    }
  }, [auth.state.status, auth.isTeacher, route.name, visibleRoutes]);

  if (auth.state.status === 'signed-out') {
    return <LoginScreen auth={auth} />;
  }

  return (
    <div className="app">
      <div className={`connectivity-bar ${online ? 'online' : 'offline'}`} role="status">
        {online ? `● ${t('common.online')}` : `◌ ${t('common.offline')}`}
      </div>

      <SessionBar
        user={auth.state.user}
        onSignOut={auth.signOut}
        locale={locale}
        fontSize={currentFontScale}
        onFontSizeChange={handleFontSizeChange}
      />

      {!ready ? (
        <p className="muted boot-loading">{t('common.loading')}</p>
      ) : route.name === 'lesson' ? (
        <LessonViewer
          lessonId={route.lessonId}
          studentId={signedInStudentId}
          locale={locale}
          onExit={() => navigate({ name: 'home' })}
        />
      ) : route.name === 'videos' ? (
        <VideoLibrary
          studentId={signedInStudentId}
          locale={locale}
          defaultBoardId={
            auth.state.status === 'signed-in' ? auth.state.user.boardId : null
          }
          onVideoSelect={(videoId) => navigate({ name: 'video', videoId })}
        />
      ) : route.name === 'video' ? (
        <VideoLecturePage
          videoId={route.videoId}
          studentId={signedInStudentId}
          locale={locale}
          onExit={() => navigate({ name: 'videos' })}
          onVideoSelect={(videoId) => navigate({ name: 'video', videoId })}
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
          user={auth.state.user}
          fontSize={currentFontScale}
          onFontSizeChange={handleFontSizeChange}
          onAvatarChange={handleAvatarChange}
        />
      ) : route.name === 'games' ? (
        <QuizArena
          studentId={signedInStudentId}
          locale={locale}
        />
      ) : route.name === 'reels' ? (
        <Reels locale={locale} onClose={() => navigate({ name: 'home' })} />
      ) : route.name === 'support' ? (
        <SupportPanel
          locale={locale}
          studentName={auth.state.status === 'signed-in' ? auth.state.user.displayName : 'Student'}
          grade={currentGrade ?? undefined}
          classId={currentClassId}
          onClose={() => navigate({ name: 'home' })}
        />
      ) : route.name === 'rewards' ? (
        <RewardsPanel
          studentId={signedInStudentId}
          studentName={auth.state.status === 'signed-in' ? auth.state.user.displayName : 'Student'}
          locale={locale}
          classId={currentClassId}
          onClose={() => navigate({ name: 'home' })}
        />
      ) : (
        <HomeScreen
          locale={locale}
          studentId={signedInStudentId}
          studentName={auth.state.status === 'signed-in' ? auth.state.user.displayName : 'Student'}
          classId={currentClassId}
          onLessonSelect={(lessonId) => navigate({ name: 'lesson', lessonId })}
        />
      )}

      <nav className="bottom-nav" aria-label="Primary">
        {auth.isTeacher ? (
          <button
            type="button"
            className={route.name === 'teacher' ? 'active' : ''}
            onClick={() => navigate({ name: 'teacher' })}
          >
            📊 {t('dashboard.title')}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={route.name === 'home' || route.name === 'lesson' ? 'active' : ''}
              onClick={() => navigate({ name: 'home' })}
            >
              📚 <span className="nav-label">{t('nav.lessons')}</span>
            </button>
            <button
              type="button"
              className={route.name === 'videos' || route.name === 'video' ? 'active' : ''}
              onClick={() => navigate({ name: 'videos' })}
            >
              🎥 <span className="nav-label">{t('video.lectures')}</span>
            </button>
            <button
              type="button"
              className={route.name === 'games' ? 'active' : ''}
              onClick={() => navigate({ name: 'games' })}
            >
              🎮 <span className="nav-label">{t('nav.games')}</span>
            </button>
            <button
              type="button"
              className={route.name === 'reels' ? 'active' : ''}
              onClick={() => navigate({ name: 'reels' })}
            >
              🎬 <span className="nav-label">{t('nav.reels')}</span>
            </button>
            <button
              type="button"
              className={route.name === 'rewards' ? 'active' : ''}
              onClick={() => navigate({ name: 'rewards' })}
            >
              🏆 <span className="nav-label">{t('nav.rewards')}</span>
            </button>
            <button
              type="button"
              className={route.name === 'support' ? 'active' : ''}
              onClick={() => navigate({ name: 'support' })}
            >
              💬 <span className="nav-label">{t('nav.support')}</span>
            </button>
          </>
        )}
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