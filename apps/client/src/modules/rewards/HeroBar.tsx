/**
 * HeroBar — the student's profile header on the Learn screen.
 * Shows avatar, level ring, XP progress, streak flame, and today's XP.
 */

import { useMemo } from 'react';
import { createTranslator, type LocaleCode } from '../../i18n';
import { levelTitleKey, type GamificationState } from '../../gamification/engine';
import { formatPercent } from '../../i18n';

interface HeroBarProps {
  studentName: string;
  state: GamificationState;
  locale: LocaleCode;
}

export function HeroBar({ studentName, state, locale }: HeroBarProps) {
  const { t } = createTranslator(locale);

  const levelLabel = t(levelTitleKey(state.level));
  const xpPercent = state.xpForNextLevel > 0 ? (state.xpIntoLevel / state.xpForNextLevel) * 100 : 100;

  const streakText = useMemo(() => {
    if (state.streak.current === 0) return t('rewards.streak_empty');
    if (state.streak.activeToday) return t('rewards.streak_today');
    return t('rewards.streak', { days: state.streak.current });
  }, [state.streak.current, state.streak.activeToday, t]);

  return (
    <div className="hero-bar" role="region" aria-label={t('rewards.title')}>
      <div className="hero-avatar" aria-hidden="true">
        {studentName.charAt(0).toUpperCase()}
      </div>
      <div className="hero-info">
        <div className="hero-name-row">
          <span className="hero-name">{studentName}</span>
          <span className="hero-level-badge">
            {t('rewards.level', { level: state.level })} — {levelLabel}
          </span>
        </div>
        <div className="hero-xp-row">
          <div className="hero-xp-bar" role="progressbar" aria-valuenow={Math.round(xpPercent)} aria-valuemin={0} aria-valuemax={100} aria-label={t('rewards.xp_to_next', { xp: state.xpToNextLevel })}>
            <div className="hero-xp-fill" style={{ width: `${xpPercent}%` }} />
          </div>
          <span className="hero-xp-text">{t('rewards.xp', { xp: state.xp })}</span>
        </div>
        <div className="hero-streak-row">
          <span className="hero-streak" aria-label={streakText}>{streakText}</span>
          <span className="hero-today-xp">{t('rewards.xp', { xp: state.todayXp })} today</span>
        </div>
      </div>
    </div>
  );
}