/**
 * MentorInbox — the teacher side of "ask a mentor".
 *
 * Lists what students have asked and lets the teacher close a thread. Role
 * enforcement is server-side (`requireRole`), so a student calling this endpoint
 * gets a 403 regardless of what this component shows.
 */

import { useCallback, useEffect, useState } from 'react';
import { playQuest } from '../../gamification/sfx';
import { createTranslator, type LocaleCode } from '../../i18n';
import { fetchMentorInbox, resolveMentorRequest, type MentorRequest } from './api';

export function MentorInbox({ locale }: { locale: LocaleCode }) {
  const { t } = createTranslator(locale);
  const [requests, setRequests] = useState<MentorRequest[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRequests(await fetchMentorInbox());
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await resolveMentorRequest(id);
        playQuest();
        setRequests((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: 'answered' } : r)),
        );
      } catch {
        setState('error');
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  if (state === 'loading') {
    return (
      <section className="panel" aria-busy="true">
        <h2>📬 {t('support.inbox')}</h2>
        <p className="muted">{t('common.loading')}</p>
      </section>
    );
  }

  return (
    <section className="panel" aria-label="Student questions">
      <h2>📬 {t('support.inbox')}</h2>
      {state === 'error' ? (
        <>
          <p className="error">{t('support.inbox_load_failed')}</p>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>
            {t('support.retry')}
          </button>
        </>
      ) : requests.length === 0 ? (
        <p className="muted">{t('support.inbox_empty')}</p>
      ) : (
        <ul className="support-thread">
          {requests.map((request) => (
            <li key={request.id} className="support-thread-item">
              <div className="support-thread-head">
                <span>
                  <strong>{request.student_name}</strong> · {request.subject}
                </span>
                <span className={`support-status ${request.status}`}>{request.status}</span>
              </div>
              <p className="support-thread-body">{request.body}</p>
              {request.status === 'open' && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busyId === request.id}
                  onClick={() => void resolve(request.id)}
                >
                  {busyId === request.id ? t('support.marking') : t('support.mark_answered')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}