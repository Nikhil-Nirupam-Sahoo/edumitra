/**
 * SessionBar — who is signed in, and a way out.
 *
 * Shows the role chip so it is always obvious whether you are looking at the
 * student experience or the teacher's.
 */

import { createTranslator, type LocaleCode } from '../i18n';
import type { SessionUser } from './client';

export function SessionBar({
  user,
  onSignOut,
  locale,
}: {
  user: SessionUser;
  onSignOut: () => void;
  locale: LocaleCode;
}) {
  const { t } = createTranslator(locale);
  const isTeacher = user.role === 'teacher';

  return (
    <div className="session-bar">
      <span className="session-avatar" aria-hidden="true">
        {isTeacher ? '🧑‍🏫' : '🎒'}
      </span>
      <div className="session-info">
        <span className="session-name">{user.displayName}</span>
        <span className={`session-role session-role-${user.role}`}>
          {isTeacher
            ? t('dashboard.title')
            : `${t('dashboard.class')} ${user.classId?.replace('class-', '') ?? '—'}`}
        </span>
      </div>
      <button type="button" className="btn btn-ghost session-signout" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}