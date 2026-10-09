/**
 * SessionBar — who is signed in, how big the text is, and a way out.
 *
 * Shows the profile picture when one is set (else the role emoji),
 * quick text-size controls so a student never has to hunt for them,
 * and the board a student follows.
 */

import { createTranslator, type LocaleCode } from '../i18n';
import { FONT_STEPS } from '../appearance';
import type { SessionUser } from './client';

export function SessionBar({
  user,
  onSignOut,
  locale,
  fontSize,
  onFontSizeChange,
}: {
  user: SessionUser;
  onSignOut: () => void;
  locale: LocaleCode;
  fontSize: number;
  onFontSizeChange: (scale: number) => void;
}) {
  const { t } = createTranslator(locale);
  const isTeacher = user.role === 'teacher';
  const stepIndex = Math.max(
    0,
    FONT_STEPS.findIndex((s) => Math.abs(s - fontSize) < 0.02),
  );

  const changeSize = (delta: number) => {
    const next = FONT_STEPS[Math.min(FONT_STEPS.length - 1, Math.max(0, stepIndex + delta))];
    if (next !== undefined) onFontSizeChange(next);
  };

  return (
    <div className="session-bar">
      <span className="session-avatar" aria-hidden={user.avatarUrl ? undefined : 'true'}>
        {user.avatarUrl ? (
          <img className="session-avatar-img" src={user.avatarUrl} alt="" />
        ) : isTeacher ? (
          '🧑‍🏫'
        ) : (
          '🎒'
        )}
      </span>
      <div className="session-info">
        <span className="session-name">{user.displayName}</span>
        <span className={`session-role session-role-${user.role}`}>
          {isTeacher
            ? t('dashboard.title')
            : [
                t('dashboard.class'),
                user.classId?.replace('class-', '') ?? '—',
                user.boardId ? `· ${user.boardId.replace(/_/g, ' ')}` : '',
              ]
                .filter(Boolean)
                .join(' ')}
        </span>
      </div>

      <div className="session-fontsize" role="group" aria-label={t('settings.font_size')}>
        <button
          type="button"
          className="btn btn-ghost fontsize-btn"
          onClick={() => changeSize(-1)}
          disabled={stepIndex <= 0}
          aria-label={t('settings.text_smaller')}
          title={t('settings.text_smaller')}
        >
          𝐴⁻
        </button>
        <button
          type="button"
          className="btn btn-ghost fontsize-btn"
          onClick={() => changeSize(1)}
          disabled={stepIndex >= FONT_STEPS.length - 1}
          aria-label={t('settings.text_bigger')}
          title={t('settings.text_bigger')}
        >
          𝐴⁺
        </button>
      </div>

      <button type="button" className="btn btn-ghost session-signout" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}
