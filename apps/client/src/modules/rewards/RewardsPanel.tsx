/**
 * RewardsPanel — the full rewards screen (route #/rewards).
 * Hero, stats row, streak calendar, badge shelf, daily quests, class leaderboard.
 */

import { useEffect, useMemo, useState } from 'react';
import { createTranslator, type LocaleCode } from '../../i18n';
import { getAllStudents, getAllXpEvents, getXpEvents } from '../../db/client';
import { deriveGamification, type GamificationState, BADGES, pickDailyQuests, localDayKey } from '../../gamification/engine';
import type { XpEvent } from '../../db/schema';
import { setSoundEnabled, isSoundEnabled, playCorrect } from '../../gamification/sfx';
import { HeroBar } from './HeroBar';
import { QuestList } from './QuestList';

interface RewardsPanelProps {
  studentId: string;
  studentName: string;
  locale: LocaleCode;
  classId: string;
  onClose: () => void;
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function weekDayKeys(now: number): string[] {
  const keys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
  }
  return keys;
}

function classIdToGrade(classId: string): number | null {
  const m = classId.match(/class-(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function RewardsPanel({ studentId, studentName, locale, classId, onClose }: RewardsPanelProps) {
  const { t } = createTranslator(locale);
  const [state, setState] = useState<GamificationState>(() => deriveGamification([], Date.now()));
  const [classmates, setClassmates] = useState<Array<{ id: string; name: string; xp: number; level: number }>>([]);
  const [soundOn, setSoundOn] = useState(isSoundEnabled());

  useEffect(() => {
    async function load() {
      const [events, students] = await Promise.all([
        getXpEvents(studentId),
        getAllStudents(),
      ]);
      setState(deriveGamification(events, Date.now()));

      const grade = classIdToGrade(classId);
      const peers = students.filter((s) => s.class_id === classId && s.id !== studentId);
      const allEvents = await getAllXpEvents();
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const leaderboard = peers
        .map((peer) => {
          const peerEvents = allEvents.filter((e) => e.student_id === peer.id && e.created_at >= weekAgo);
          const peerState = deriveGamification(peerEvents, Date.now());
          return { id: peer.id, name: peer.name, xp: peerState.weekXp, level: peerState.level };
        })
        .sort((a, b) => b.xp - a.xp)
        .slice(0, 5);
      setClassmates(leaderboard);
    }
    load();
  }, [studentId, classId]);

  const streakKeys = weekDayKeys(Date.now());
  const todayKey = localDayKey(Date.now());

  const soundToggle = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) playCorrect(1);
  };

  return (
    <div className="rewards-panel">
      <header className="rewards-header">
        <HeroBar studentName={studentName} state={state} locale={locale} />
        <button className="rewards-sound-toggle" onClick={soundToggle} aria-label={soundOn ? 'Mute' : 'Unmute'} aria-pressed={soundOn}>
          {soundOn ? '🔊' : '🔇'}
        </button>
      </header>

      <section className="rewards-stats" aria-label={t('rewards.stats')}>
        <div className="stat"><span className="stat-value">{state.lessonsCompleted}</span><span className="stat-label">{t('rewards.lessons_done')}</span></div>
        <div className="stat"><span className="stat-value">{state.perfectCount}</span><span className="stat-label">{t('rewards.perfect')}</span></div>
        <div className="stat"><span className="stat-value">{Math.round(state.accuracy * 100)}%</span><span className="stat-label">{t('rewards.accuracy')}</span></div>
        <div className="stat"><span className="stat-value">{state.streak.longest}</span><span className="stat-label">{t('rewards.longest_streak')}</span></div>
      </section>

      <section className="rewards-streak-cal" aria-label={t('rewards.streak')}>
        <div className="streak-cal-header">{t('rewards.streak', { days: state.streak.current })}</div>
        <div className="streak-cal-grid" role="img" aria-label={`Streak calendar`}>
          {streakKeys.map((key) => {
            const [y, m, d] = key.split('-').map((n) => parseInt(n, 10));
            const dayIdx = new Date(y, m - 1, d).getDay();
            return (
              <div
                key={key}
                className={`streak-day ${state.streak.current > 0 && state.streak.activeToday && key === todayKey ? 'active today' : ''} ${state.streak.current > 0 && !state.streak.activeToday && key === todayKey ? 'pending today' : ''}`}
                aria-hidden="true"
              >
                <span className="streak-day-label">{DAY_LABELS[dayIdx]}</span>
                <span className={`streak-day-dot ${state.streak.current > 0 && key !== todayKey ? 'filled' : ''}`} />
              </div>
            );
          })}
        </div>
      </section>

      <section className="rewards-badges" aria-label={t('rewards.badges')}>
        <h3>{t('rewards.badges')}</h3>
        <div className="badge-grid">
          {BADGES.map((badge) => {
            const earned = state.badges.includes(badge.id);
            return (
              <article key={badge.id} className={`badge-card ${earned ? '' : 'locked'}`}>
                <span className="badge-icon" aria-hidden="true">{badge.icon}</span>
                <span className="badge-name">{t(badge.nameKey)}</span>
                {!earned && <span className="badge-locked" aria-label={t('rewards.locked', { hint: t(badge.descKey) })}>🔒</span>}
              </article>
            );
          })}
        </div>
      </section>

      <section className="rewards-quests" aria-label={t('rewards.quests')}>
        <h3>{t('rewards.quests')}</h3>
        <QuestList quests={state.quests} locale={locale} />
      </section>

      <section className="rewards-leaderboard" aria-label={t('rewards.leaderboard')}>
        <h3>{t('rewards.leaderboard')}</h3>
        <ol className="leaderboard-list">
          <li className="leaderboard-item me">
            <span className="leaderboard-rank">★</span>
            <span className="leaderboard-name">{studentName} (you)</span>
            <span className="leaderboard-xp">{t('rewards.xp', { xp: state.weekXp })}</span>
          </li>
          {classmates.map((peer, i) => (
            <li key={peer.id} className="leaderboard-item">
              <span className="leaderboard-rank">{i + 1}</span>
              <span className="leaderboard-name">{peer.name}</span>
              <span className="leaderboard-xp">{t('rewards.xp', { xp: peer.xp })}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}