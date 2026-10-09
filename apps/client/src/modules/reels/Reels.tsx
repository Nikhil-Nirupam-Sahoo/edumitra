/**
 * Reels — a vertical, snap-scrolling feed of one idea per card.
 *
 * Each card pairs the chapter's animated figure with its key point and a
 * single-tap question, so a swipe is a complete micro-lesson. Everything is
 * derived from the downloaded syllabus and rendered as SVG, so the feed works
 * offline and adds no video megabytes to the PWA.
 */

import { useEffect, useMemo, useState } from 'react';
import { getLessons } from '../../db/client';
import type { LessonCard, QuizCard, TextCard } from '../../modules/lesson/lessonModel';
import type { SyllabusSubjectId } from '../../db/schema';
import { LessonArt } from '../../art/LessonArt';
import { LessonPhoto } from '../../art/LessonPhoto';
import { playCorrect, playWrong } from '../../gamification/sfx';
import { createTranslator, type LocaleCode } from '../../i18n';

interface Reel {
  id: string;
  lessonId: string;
  lessonTitle: string;
  subject: string;
  grade: number | undefined;
  kicker: string;
  title: string;
  body: string;
  quiz?: { id: string; question: string; options: string[]; correctIndex: number; hint?: string };
}

function parseCards(json: string): LessonCard[] {
  try {
    const parsed = JSON.parse(json) as { cards?: LessonCard[] };
    return Array.isArray(parsed.cards) ? parsed.cards : [];
  } catch {
    return [];
  }
}

const SUBJECT_LABEL: Record<string, string> = {
  math: 'Math',
  science: 'Science',
  sst: 'Social Studies',
  english: 'English',
  practice: 'Practice',
};

/** One reel per lesson: the intro idea plus a question to check it. */
function buildReels(lessons: Awaited<ReturnType<typeof getLessons>>): Reel[] {
  const reels: Reel[] = [];
  for (const lesson of lessons) {
    const cards = parseCards(lesson.content_json);
    const intro = cards.find((c): c is TextCard => c.type === 'text');
    if (!intro?.title || !intro.body) continue;
    const quiz = cards.find((c): c is QuizCard => c.type === 'quiz');
    const reel: Reel = {
      id: `${lesson.id}:reel`,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      subject: lesson.subject ?? 'practice',
      grade: typeof lesson.grade === 'number' ? lesson.grade : undefined,
      kicker: lesson.grade ? `Class ${lesson.grade} · ${SUBJECT_LABEL[lesson.subject ?? 'practice'] ?? ''}` : 'Practice',
      title: intro.title,
      body: intro.body.length > 300 ? `${intro.body.slice(0, 297).trimEnd()}…` : intro.body,
    };
    if (quiz && quiz.options.length >= 2) {
      const correctIndex = quiz.options.findIndex((o) => o.id === quiz.correctOptionId);
      if (correctIndex >= 0) {
        reel.quiz = {
          id: quiz.questionId,
          question: quiz.question,
          options: quiz.options.map((o) => o.text),
          correctIndex,
          hint: quiz.explanation,
        };
      }
    }
    reels.push(reel);
  }
  return reels;
}

export function Reels({ locale, onClose }: { locale: LocaleCode; onClose: () => void }) {
  const { t } = createTranslator(locale);
  const [reels, setReels] = useState<Reel[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    getLessons()
      .then((lessons) => {
        if (!cancelled) setReels(buildReels(lessons));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (reels.length === 0) {
    return (
      <div className="reels-empty" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
        <p className="muted">{t('reels.loading')}</p>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          ← {t('nav.back')}
        </button>
      </div>
    );
  }

  const answer = (reel: Reel, optionIndex: number) => {
    if (!reel.quiz || answers[reel.id] !== undefined) return;
    setAnswers((prev) => ({ ...prev, [reel.id]: optionIndex }));
    if (optionIndex === reel.quiz.correctIndex) playCorrect(1);
    else playWrong();
  };

  return (
    <div className="reels" role="feed" aria-label="Reels">
      {reels.map((reel, index) => {
        const chosen = answers[reel.id];
        const revealed = chosen !== undefined;
        return (
          <article key={reel.id} className="reel" aria-label={reel.title}>
            <LessonArt
              className="reel-art"
              subject={reel.subject as SyllabusSubjectId}
              lessonId={reel.lessonId}
              variant={index}
            />
            <LessonPhoto
              className="reel-photo"
              lessonId={reel.lessonId}
              locale={locale}
              size="hero"
              alt={reel.lessonTitle}
            />
            <p className="reel-kicker">{reel.kicker}</p>
            <h2 className="reel-title">{reel.title}</h2>
            <p className="reel-body">{reel.body}</p>

            {reel.quiz && (
              <div className="reel-quiz">
                <button
                  type="button"
                  className="reel-btn primary"
                  onClick={() => setOpen((o) => ({ ...o, [reel.id]: !o[reel.id] }))}
                  aria-expanded={Boolean(open[reel.id])}
                >
                  {open[reel.id] ? t('reels.hide_question') : t('reels.quick_check')}
                </button>

                {open[reel.id] && (
                  <div style={{ marginTop: '0.6rem' }}>
                    <p className="reel-quiz-q">{reel.quiz.question}</p>
                    {reel.quiz.options.map((option, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`reel-opt ${
                          revealed && i === reel.quiz!.correctIndex ? 'right' : ''
                        } ${revealed && chosen === i && i !== reel.quiz!.correctIndex ? 'wrong' : ''}`}
                        onClick={() => answer(reel, i)}
                        disabled={revealed}
                      >
                        {option}
                      </button>
                    ))}
                    {revealed && reel.quiz.hint && <p className="reel-hint">{reel.quiz.hint}</p>}
                  </div>
                )}
              </div>
            )}

            <div className="reel-actions">
              <span className="muted" style={{ fontSize: '0.72rem' }}>
                {reel.lessonTitle}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}