/**
 * QuestList — renders the three daily quests with progress bars.
 * Pure presentational: receives already-derived QuestState.
 */

import { createTranslator, type LocaleCode } from '../../i18n';
import type { QuestState } from '../../gamification/engine';

interface QuestListProps {
  quests: QuestState[];
  locale: LocaleCode;
}

export function QuestList({ quests, locale }: QuestListProps) {
  const { t } = createTranslator(locale);

  if (quests.length === 0) {
    return <div className="quest-list-empty">{t('rewards.no_quests')}</div>;
  }

  return (
    <div className="quest-list" role="list" aria-label={t('home.daily_quests')}>
      {quests.map((quest) => (
        <article key={quest.id} className={`quest-card ${quest.done ? 'quest-done' : ''}`} role="listitem">
          <div className="quest-header">
            <span className="quest-icon" aria-hidden="true">{quest.icon}</span>
            <span className="quest-title">{t(quest.titleKey)}</span>
            {quest.done && <span className="quest-done-badge">{t('quest.done', { reward: quest.reward })}</span>}
          </div>
          <div className="quest-progress-wrap">
            <div
              className="quest-progress-bar"
              role="progressbar"
              aria-valuenow={quest.progress}
              aria-valuemin={0}
              aria-valuemax={quest.target}
              aria-label={`${t(quest.titleKey)}: ${quest.progress} of ${quest.target}`}
            >
              <div className="quest-progress-fill" style={{ width: `${(quest.progress / quest.target) * 100}%` }} />
            </div>
            <span className="quest-progress-text">{t('quest.progress', { done: quest.progress, target: quest.target })}</span>
          </div>
        </article>
      ))}
    </div>
  );
}