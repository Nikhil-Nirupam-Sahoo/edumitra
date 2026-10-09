/**
 * Support — ask a mentor or the AI tutor.
 *
 * Two real paths, no fake ones:
 *  - Mentor: the teacher list comes from the server, questions are stored and
 *    appear in that teacher's dashboard inbox, and the student sees the status.
 *  - AI tutor: a server-side proxy to Anthropic. When no key is configured the
 *    panel says so plainly instead of showing a bot that cannot answer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { playQuest } from '../../gamification/sfx';
import { createTranslator, type LocaleCode } from '../../i18n';
import {
  askTutor,
  fetchMentors,
  fetchMyRequests,
  sendMentorRequest,
  supportStatus,
  type ChatTurn,
  type Mentor,
  type MentorRequest,
} from './api';

interface SupportPanelProps {
  locale: LocaleCode;
  studentName: string;
  grade?: number;
  classId: string | null;
  onClose: () => void;
}

const GREETING_KEY = 'support.ai_greeting';

export function SupportPanel({
  locale,
  studentName,
  grade,
  classId,
  onClose,
}: SupportPanelProps) {
  const { t } = createTranslator(locale);
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [mine, setMine] = useState<MentorRequest[]>([]);
  const [mentorId, setMentorId] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([
    { role: 'assistant', content: t(GREETING_KEY) },
  ]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      const [status, mentorList, requests] = await Promise.all([
        supportStatus(),
        fetchMentors(),
        fetchMyRequests(),
      ]);
      setAiEnabled(status.aiEnabled);
      setMentors(mentorList);
      setMentorId((current) => current || mentorList[0]?.id || '');
      setMine(requests);
    })();
  }, []);

  // Keep the newest message in view as the tutor replies.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns, thinking]);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const message = draft.trim();
      if (!message || thinking) return;
      const history = turns.slice(-8);
      setTurns((prev) => [...prev, { role: 'user', content: message }]);
      setDraft('');
      setThinking(true);
      try {
        const answer = await askTutor(message, history, {
          grade,
          className: classId ?? undefined,
        });
        setTurns((prev) => [...prev, { role: 'assistant', content: answer }]);
      } catch (error) {
        const code = error instanceof Error ? error.message : 'unknown';
        setTurns((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: t(
              code === 'ai_unavailable' ? 'support.ai_unavailable_reply' : 'support.ai_fallback',
            ),
          },
        ]);
      } finally {
        setThinking(false);
      }
    },
    [draft, turns, thinking, grade, classId, t],
  );

  const ask = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!subject.trim() || !body.trim() || sending) return;
      setSending(true);
      setSendError(null);
      try {
        await sendMentorRequest(subject.trim(), body.trim());
        setSubject('');
        setBody('');
        setSent(true);
        playQuest();
        setMine(await fetchMyRequests());
        window.setTimeout(() => setSent(false), 4000);
      } catch {
        setSendError('Could not send right now — you need a connection for this one.');
      } finally {
        setSending(false);
      }
    },
    [subject, body, sending],
  );

  const open = mine.filter((r) => r.status === 'open').length;

  return (
    <div className="arena">
      <header className="arena-header arena-round">
        <h2>💬 {t('support.title')}</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          ← {t('nav.back')}
        </button>
      </header>

      {/* ---------------- AI tutor ---------------- */}
      <section className="support-card">
        <h3>🤖 {t('support.ai_tutor')}</h3>
        {aiEnabled === null ? (
          <p className="muted">{t('common.loading')}</p>
        ) : aiEnabled ? (
          <>
            <div className="chat-log" ref={logRef} role="log" aria-live="polite">
              {turns.map((turn, i) => (
                <div key={i} className={`chat-msg ${turn.role === 'user' ? 'me' : 'bot'}`}>
                  {turn.content}
                </div>
              ))}
              {thinking && <div className="chat-msg bot">{t('support.ai_thinking')}</div>}
            </div>
            <form className="chat-input-row" onSubmit={submit}>
              <input
                className="chat-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t('support.ask_placeholder')}
                aria-label="Message the tutor"
                maxLength={2000}
              />
              <button type="submit" className="btn btn-primary" disabled={!draft.trim() || thinking}>
                {t('support.send')}
              </button>
            </form>
            <p className="chat-note">{t('support.ai_disclaimer')}</p>
          </>
        ) : (
          <p className="muted">{t('support.ai_off')}</p>
        )}
      </section>

      {/* ---------------- Mentor ---------------- */}
      <section className="support-card">
        <h3>👩‍🏫 {t('support.mentor')}</h3>

        {mentors.length > 0 ? (
          <div className="support-mentor">
            <div className="support-avatar" aria-hidden="true">
              🎓
            </div>
            <div>
              <div className="support-mentor-name">
                {mentors.find((m) => m.id === mentorId)?.display_name ?? mentors[0]!.display_name}
              </div>
              <div className="support-mentor-sub">
                {mentors.length === 1
                  ? t('support.your_teacher')
                  : t('support.teacher_count', { count: mentors.length })}
              </div>
            </div>
          </div>
        ) : (
          <p className="muted">{t('support.mentor_load_failed')}</p>
        )}

        <form onSubmit={ask}>
          <label className="support-label" htmlFor="mentor-subject">
            {t('support.subject_label')}
          </label>
          <input
            id="mentor-subject"
            className="chat-input"
            style={{ width: '100%' }}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Linear equations, question 3"
            maxLength={120}
            required
          />
          <label className="support-label" htmlFor="mentor-body">
            {t('support.body_label')}
          </label>
          <textarea
            id="mentor-body"
            className="chat-input"
            style={{ width: '100%', minHeight: '90px', resize: 'vertical' }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="I am stuck on…"
            maxLength={2000}
            required
          />
          <div className="support-actions">
            <button type="submit" className="btn btn-primary" disabled={sending || mentors.length === 0}>
              {sending ? t('support.sending') : t('support.send_to_mentor')}
            </button>
          </div>
        </form>

        {sent && <p className="support-note ok">{t('support.sent')}</p>}
        {sendError && <p className="support-note bad">{sendError}</p>}
        <p className="chat-note">{t('support.signed_in_as', { name: studentName })}</p>
      </section>

      {/* ---------------- History ---------------- */}
      <section className="support-card">
        <h3>
          📬 {t('support.my_questions')}{' '}
          {open > 0 && (
            <span className="support-open-count">
              {t('support.open_count', { count: open })}
            </span>
          )}
        </h3>
        {mine.length === 0 ? (
          <p className="muted">{t('support.none_asked')}</p>
        ) : (
          <ul className="support-thread">
            {mine.map((request) => (
              <li key={request.id} className="support-thread-item">
                <div className="support-thread-head">
                  <span>{request.subject}</span>
                  <span className={`support-status ${request.status}`}>{request.status}</span>
                </div>
                <p className="support-thread-body">{request.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}