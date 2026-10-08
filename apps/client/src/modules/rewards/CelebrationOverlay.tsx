/**
 * CelebrationOverlay — the full-screen lesson-complete celebration.
 * Confetti + stars + XP total + level-up + new badges + quest completions.
 * One big "Continue" button dismisses it.
 */

import { useEffect, useRef } from 'react';
import { createTranslator, type LocaleCode } from '../../i18n';
import { launchConfetti, stopConfetti } from '../../gamification/confetti';
import { playStar, playLevelUp, playBadge, playQuest } from '../../gamification/sfx';
import type { GamificationState } from '../../gamification/engine';

interface CelebrationOverlayProps {
  gain: {
    xp: number;
    stars: number;
    perfect: boolean;
    levelBefore: number;
    levelAfter: number;
    newBadges: string[];
    newlyCompletedQuests: string[];
  };
  state: GamificationState;
  locale: LocaleCode;
  onClose: () => void;
}

const BADGE_LABELS: Record<string, string> = {
  first_step: 'badge.first_step.name',
  perfect: 'badge.perfect.name',
  perfect_five: 'badge.perfect_five.name',
  quiz_novice: 'badge.quiz_novice.name',
  quiz_master: 'badge.quiz_master.name',
  streak_3: 'badge.streak_3.name',
  streak_7: 'badge.streak_7.name',
  combo_5: 'badge.combo_5.name',
  bookworm: 'badge.bookworm.name',
  scholar: 'badge.scholar.name',
  level_5: 'badge.level_5.name',
  comeback: 'badge.comeback.name',
  early_bird: 'badge.early_bird.name',
};

const QUEST_LABELS: Record<string, string> = {
  q_lesson: 'quest.q_lesson.title',
  q_correct: 'quest.q_correct.title',
  q_combo: 'quest.q_combo.title',
  q_perfect: 'quest.q_perfect.title',
  q_read: 'quest.q_read.title',
  q_xp: 'quest.q_xp.title',
};

export function CelebrationOverlay({ gain, state, locale, onClose }: CelebrationOverlayProps) {
  const { t } = createTranslator(locale);
  const confettiRef = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    launchConfetti({ durationMs: 2500, particleCount: 160 });
    confettiRef.current = true;
    playStar(gain.stars);
    if (gain.levelAfter > gain.levelBefore) playLevelUp();
    if (gain.newBadges.length > 0) playBadge();
    if (gain.newlyCompletedQuests.length > 0) playQuest();
    btnRef.current?.focus();
    return () => {
      if (confettiRef.current) stopConfetti();
    };
  }, [gain]);

  const stars = Array.from({ length: gain.stars }, (_, i) => (
    <span key={i} className="celebration-star" aria-hidden="true">⭐</span>
  ));

  return (
    <div className="celebration-overlay" role="dialog" aria-modal="true" aria-labelledby="celebration-title">
      <div className="celebration-content">
        <h2 id="celebration-title" className="celebration-title">
          {gain.perfect ? t('celebration.perfect') : t('celebration.stars', { count: gain.stars, s: gain.stars !== 1 ? 's' : '' })}
        </h2>

        <div className="celebration-stars" aria-hidden="true">{stars}</div>

        <div className="celebration-xp" aria-live="polite">{t('celebration.xp', { xp: gain.xp })}</div>

        {gain.levelAfter > gain.levelBefore && (
          <div className="celebration-levelup" aria-live="polite">
            {t('celebration.level_up', { level: gain.levelAfter })}
          </div>
        )}

        {gain.newBadges.length > 0 && (
          <div className="celebration-badges" aria-live="polite">
            {gain.newBadges.map((badgeId) => (
              <div key={badgeId} className="celebration-badge">
                <span className="celebration-badge-icon" aria-hidden="true">
                  {({ first_step: '🎒', perfect: '🌟', perfect_five: '✨', quiz_novice: '🎯', quiz_master: '🏹', streak_3: '🔥', streak_7: '🌈', combo_5: '⚡', bookworm: '🐛', scholar: '🎓', level_5: '🏆', comeback: '🦸', early_bird: '🐦' } as Record<string, string>)[badgeId]}
                </span>
                {t('celebration.new_badge', { name: t(BADGE_LABELS[badgeId] ?? badgeId) })}
              </div>
            ))}
          </div>
        )}

        {gain.newlyCompletedQuests.length > 0 && (
          <div className="celebration-quests" aria-live="polite">
            {gain.newlyCompletedQuests.map((questId) => (
              <div key={questId} className="celebration-quest">
                {t('celebration.quest_done', { name: t(QUEST_LABELS[questId] ?? questId), reward: QUEST_LABELS[questId] ? '' : '' })}
              </div>
            ))}
          </div>
        )}

        <button
          ref={btnRef}
          className="celebration-continue"
          onClick={onClose}
          autoFocus
        >
          {t('celebration.continue')}
        </button>
      </div>
    </div>
  );
}