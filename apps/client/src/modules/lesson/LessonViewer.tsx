/**
 * LessonViewer — the offline cmi5/xAPI lesson renderer with gamification.
 *
 * Responsibilities:
 *  - Loads lesson content straight from the local IndexedDB cache. No fetch.
 *  - Renders micro-learning cards (text / image / audio / quiz / summary).
 *  - Fires xAPI events on lesson start, card changes and quiz submissions
 *    through `xapiLogger` (which writes to the persistent queue).
 *  - Awards XP, updates streaks, stars, badges, quests via the gamification engine.
 *  - Shows instant feedback: XP bursts, combo pill, confetti, sounds.
 *  - Audio-assisted overlay controls for low-literacy students.
 *  - Keyboard + screen-reader accessible; works at 320px width.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getLesson, getProgress, type ProgressPatch } from '../../db/client';
import type { LessonRecord, SyllabusSubjectId } from '../../db/schema';
import { createTranslator, formatPercent, type LocaleCode } from '../../i18n';
import {
  logCardViewed,
  logLessonCompleted,
  logLessonStarted,
  logQuestionAnswered,
} from '../../sync/xapiLogger';
import type { LessonCard, LessonContent, QuizCard } from './lessonModel';
import { parseLessonContent } from './lessonModel';
import { mediaUrl, useAudioCues } from './useAudioCues';
import { useGamification, type XpGain } from '../../gamification/store';
import { XpBurst } from '../rewards/XpBurst';
import { CelebrationOverlay } from '../rewards/CelebrationOverlay';
import { LessonArt } from '../../art/LessonArt';
import { playCorrect, playWrong } from '../../gamification/sfx';
import { useSpeech } from '../../tts/useSpeech';

export interface LessonViewerProps {
  lessonId: string;
  studentId: string;
  locale: LocaleCode;
  /** Called when the student leaves the lesson (to refresh surrounding views). */
  onExit?: () => void;
}

interface LoadState {
  status: 'loading' | 'ready' | 'missing';
  lesson: LessonRecord | null;
  content: LessonContent | null;
}

interface QuizAttempt {
  optionId: string;
  isCorrect: boolean;
  submittedAt: number;
}

const DEFAULT_LOAD: LoadState = { status: 'loading', lesson: null, content: null };

export function LessonViewer({ lessonId, studentId, locale, onExit }: LessonViewerProps) {
  const { t } = useMemo(() => createTranslator(locale), [locale]);
  const audio = useAudioCues();
  const speech = useSpeech(locale);

  // Gamification
  const { state: gameState, recordQuizAnswer, recordCardRead, recordLessonComplete, status: gameStatus } = useGamification(studentId);

  const [load, setLoad] = useState<LoadState>(DEFAULT_LOAD);
  const [cardIndex, setCardIndex] = useState(0);
  const [attempts, setAttempts] = useState<Record<string, QuizAttempt>>({});
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [celebration, setCelebration] = useState<XpGain | null>(null);
  const [burst, setBurst] = useState<{ xp: number; combo: number; key: number; x: number; y: number } | null>(null);
  const [sessionXp, setSessionXp] = useState(0);

  const sessionStartRef = useRef<number>(Date.now());
  const cardEnteredAtRef = useRef<number>(Date.now());
  const startedRef = useRef(false);
  const completedRef = useRef(false);

  // ---- Load lesson + saved position from local DB -------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const record = await getLesson(lessonId);
      if (cancelled) return;
      if (!record) {
        setLoad({ status: 'missing', lesson: null, content: null });
        return;
      }
      const content = parseLessonContent(record.content_json, record.id);
      const progress = await getProgress(studentId, lessonId);
      if (cancelled) return;
      setLoad({ status: 'ready', lesson: record, content });
      setCardIndex(
        progress && progress.last_card_index > 0
          ? Math.min(progress.last_card_index, content.cards.length - 1)
          : 0,
      );
    })().catch((error) => {
      console.error('[lesson] failed to load', error);
      if (!cancelled) setLoad({ status: 'missing', lesson: null, content: null });
    });
    return () => {
      cancelled = true;
    };
  }, [lessonId, studentId]);

  // ---- Fire lesson-started exactly once per mount -------------------------
  useEffect(() => {
    if (load.status !== 'ready' || startedRef.current) return;
    startedRef.current = true;
    sessionStartRef.current = Date.now();
    cardEnteredAtRef.current = Date.now();
    void logLessonStarted(studentId, lessonId, { language: load.content?.language ?? locale }).catch(
      (error) => console.error('[lesson] start log failed', error),
    );
  }, [load.status, load.content?.language, studentId, lessonId, locale]);

  const cards = load.content?.cards ?? [];
  const card: LessonCard | undefined = cards[cardIndex];
  const quizCards = useMemo(() => cards.filter((c): c is QuizCard => c.type === 'quiz'), [cards]);

  // Stable per-lesson seed for the decorative scene art. Declared with the
  // other hooks — a hook below the early returns below would be skipped on
  // the first render and called later, which React rejects.
  const artVariant = useMemo(() => {
    const id = load.lesson?.id ?? '';
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 997;
    return hash;
  }, [load.lesson?.id]);

  const finalScore = useMemo(() => {
    if (quizCards.length === 0) return 1;
    const correct = quizCards.filter((q) => attempts[q.questionId]?.isCorrect).length;
    return correct / quizCards.length;
  }, [quizCards, attempts]);

  // ---- Emit card-view events + time-on-task + gamification card_read ------
  useEffect(() => {
    if (load.status !== 'ready' || !card || gameStatus !== 'ready') return;
    const enteredAt = Date.now();
    cardEnteredAtRef.current = enteredAt;
    return () => {
      const dwellMs = Date.now() - enteredAt;
      // Ignore sub-500ms glances (double navigation) to keep telemetry clean.
      if (dwellMs >= 500) {
        void logCardViewed(studentId, lessonId, cardIndex, dwellMs, {
          language: load.content?.language ?? locale,
        }).catch((error) => console.error('[lesson] card log failed', error));

        // Gamification: record card read (deduped in engine)
        void recordCardRead({ studentId, lessonId, cardId: card.id }).catch(console.error);
      }
    };
  }, [cardIndex, card, load.status, load.content?.language, studentId, lessonId, locale, gameStatus, recordCardRead]);

  // ---- Navigation ----------------------------------------------------------
  const goToCard = useCallback(
    (next: number) => {
      setSelectedOption(null);
      setShowExplanation(false);
      setCardIndex(Math.max(0, Math.min(next, Math.max(0, cards.length - 1))));
      audio.stop();
    },
    [cards.length, audio],
  );

  const completeLesson = useCallback(
    async (score: number) => {
      if (completedRef.current) return;
      completedRef.current = true;
      try {
        await logLessonCompleted(studentId, lessonId, score, {
          language: load.content?.language ?? locale,
        });
      } catch (error) {
        console.error('[lesson] completion log failed', error);
      }
    },
    [studentId, lessonId, load.content?.language, locale],
  );

  const handleNext = useCallback(async () => {
    const isLast = cardIndex >= cards.length - 1;
    if (isLast) {
      await completeLesson(finalScore);
      // Record gamification for lesson completion
      const gain = await recordLessonComplete({ studentId, lessonId, score: finalScore });
      if (gain) {
        setSessionXp((prev) => prev + gain.xp);
        setCelebration(gain);
        return; // Celebration overlay will call onExit
      }
      onExit?.();
      return;
    }
    goToCard(cardIndex + 1);
  }, [cardIndex, cards.length, completeLesson, finalScore, goToCard, onExit, recordLessonComplete]);

  // ---- Quiz submission -----------------------------------------------------
  const submitAnswer = useCallback(
    async (quiz: QuizCard) => {
      if (!selectedOption) return;
      const isCorrect = selectedOption === quiz.correctOptionId;
      setAttempts((prev) => ({
        ...prev,
        [quiz.questionId]: { optionId: selectedOption, isCorrect, submittedAt: Date.now() },
      }));
      setShowExplanation(true);
      try {
        await logQuestionAnswered(
          studentId,
          lessonId,
          quiz.questionId,
          selectedOption,
          isCorrect,
          { language: load.content?.language ?? locale },
        );
      } catch (error) {
        console.error('[lesson] answer log failed', error);
      }

      // Gamification: record quiz answer
      const gain = await recordQuizAnswer({
        studentId,
        lessonId,
        questionId: quiz.questionId,
        correct: isCorrect,
      });
      if (gain) {
        setSessionXp((prev) => prev + gain.xp);
        // Position burst near the submit button (approximate center-bottom)
        setBurst({ xp: gain.xp, combo: gain.combo, key: Date.now(), x: window.innerWidth / 2, y: window.innerHeight * 0.7 });
        // Sound
        if (isCorrect) playCorrect(gain.combo);
        else playWrong();
      }
    },
    [selectedOption, studentId, lessonId, load.content?.language, locale, recordQuizAnswer],
  );

  // ---- Dismiss celebration -> exit lesson ----------------------------------
  const dismissCelebration = useCallback(() => {
    setCelebration(null);
    onExit?.();
  }, [onExit]);

  // ---- Render states -------------------------------------------------------
  if (load.status === 'loading') {
    return (
      <div className="lesson-viewer" aria-busy="true">
        <p className="muted">{t('common.loading')}</p>
      </div>
    );
  }

  if (load.status === 'missing' || !load.content || cards.length === 0) {
    return (
      <div className="lesson-viewer" role="alert">
        <p>{t('lesson.no_lessons')}</p>
        {onExit && (
          <button type="button" className="btn btn-secondary" onClick={onExit}>
            {t('nav.back')}
          </button>
        )}
      </div>
    );
  }

  const isLastCard = cardIndex >= cards.length - 1;
  const progressPercent = formatPercent((cardIndex + 1) / cards.length);

  return (
    <div className="lesson-viewer">
      {/* Celebration overlay (modal) */}
      {celebration && (
        <CelebrationOverlay
          gain={celebration}
          state={gameState}
          locale={locale}
          onClose={dismissCelebration}
        />
      )}

      <header className="lesson-header">
        <button type="button" className="btn btn-ghost" onClick={onExit} disabled={!!celebration}>
          ← {t('nav.back')}
        </button>
        <h1 className="lesson-title">{load.lesson?.title}</h1>
        {/* Combo pill */}
        {gameState.currentCombo >= 2 && (
          <span className="combo-pill" aria-label={t('combo.pill', { combo: gameState.currentCombo })}>
            {t('combo.fire')} {t('combo.pill', { combo: gameState.currentCombo })}
          </span>
        )}
        <span className="lesson-progress" aria-label={t('common.progress')}>
          {progressPercent}
        </span>
      </header>

      <div
        className="lesson-progressbar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(((cardIndex + 1) / cards.length) * 100)}
      >
        <div
          className="lesson-progressbar-fill"
          style={{ width: `${((cardIndex + 1) / cards.length) * 100}%` }}
        />
      </div>

      {/* Animated subject scene — purely decorative, hidden from screen readers */}
      <LessonArt
        subject={(load.lesson?.subject ?? 'practice') as SyllabusSubjectId}
        lessonId={load.lesson?.id}
        variant={artVariant}
      />

      <main className="lesson-card lesson-card--with-art" key={card?.id ?? cardIndex}>
        {card && (
          <div className="card-topline">
            <CardBody card={card} audio={audio} t={t} />
            {/* Read the whole card aloud: the primary path for a student who
                cannot read the screen comfortably. */}
            {speech.available && cardReadableAloud(card) && (
              <button
                type="button"
                className="btn btn-ghost card-listen"
                onClick={() =>
                  speech.read(`card-${card.id}`, cardReadableAloud(card) ?? '')
                }
                aria-pressed={speech.speakingId === `card-${card.id}`}
              >
                {speech.speakingId === `card-${card.id}`
                  ? `⏸ ${t('lesson.stop_listen')}`
                  : `🔊 ${t('lesson.listen')}`}
              </button>
            )}
          </div>
        )}

        {card?.type === 'quiz' && (
          <QuizBody
            quiz={card}
            t={t}
            selectedOption={selectedOption}
            onSelect={(optionId) => {
              setSelectedOption(optionId);
              setShowExplanation(false);
            }}
            onSubmit={() => void submitAnswer(card)}
            attempt={attempts[card.questionId]}
            showExplanation={showExplanation}
            speech={speech}
            onReadFeedback={speech.read}
          />
        )}

        {card?.type === 'summary' && (
          <div className="lesson-summary">
            <p className="score-line">
              {t('lesson.you_scored', { percent: Math.round(finalScore * 100) })}
            </p>
            {sessionXp > 0 && (
              <p className="session-xp-line">{t('celebration.xp', { xp: sessionXp })} this lesson</p>
            )}
          </div>
        )}
      </main>

      <footer className="lesson-footer">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => goToCard(cardIndex - 1)}
          disabled={cardIndex === 0 || !!celebration}
        >
          {t('common.previous')}
        </button>
        <button type="button" className="btn btn-primary" onClick={handleNext} disabled={!!celebration}>
          {isLastCard ? t('lesson.finish') : t('common.next')}
        </button>
      </footer>

      {/* XP burst toast */}
      {burst && (
        <XpBurst key={burst.key} xp={burst.xp} combo={burst.combo} x={burst.x} y={burst.y} onEnd={() => setBurst(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card rendering
// ---------------------------------------------------------------------------

interface CardBodyProps {
  card: LessonCard;
  audio: ReturnType<typeof useAudioCues>;
  t: ReturnType<typeof createTranslator>['t'];
}

function CardBody({ card, audio, t }: CardBodyProps) {
  const audioSource = card.audioCue ? mediaUrl(card.audioCue) : '';
  const cueId = `${card.id}:cue`;

  return (
    <article className="card-body" aria-labelledby={`card-title-${card.id}`}>
      <header className="card-header">
        <h2 id={`card-title-${card.id}`} className="card-title">
          {card.title ?? t('common.progress')}
        </h2>
        {audioSource && (
          <button
            type="button"
            className="btn btn-audio"
            aria-pressed={audio.playingId === cueId}
            onClick={() =>
              audio.playingId === cueId ? audio.stop() : audio.play(cueId, audioSource)
            }
          >
            🔊 {audio.playingId === cueId ? t('lesson.stop_listen') : t('lesson.listen')}
          </button>
        )}
      </header>

      {card.type === 'text' && <p className="card-text">{card.body}</p>}

      {card.type === 'image' && (
        <figure className="card-figure">
          <img
            src={mediaUrl(card.imageUrl)}
            alt={card.caption ?? card.title ?? ''}
            width={card.width}
            height={card.height}
            loading="lazy"
            decoding="async"
          />
          {card.caption && <figcaption>{card.caption}</figcaption>}
        </figure>
      )}

      {card.type === 'audio' && (
        <div className="card-audio">
          <button
            type="button"
            className="btn btn-audio"
            onClick={() => audio.play(cueId, mediaUrl(card.audioUrl))}
          >
            ▶ {t('lesson.listen')}
          </button>
          {card.transcript && <p className="card-text transcript">{card.transcript}</p>}
        </div>
      )}

      {card.type === 'summary' && <p className="card-text">{card.body}</p>}
    </article>
  );
}

interface QuizBodyProps {
  quiz: QuizCard;
  t: ReturnType<typeof createTranslator>['t'];
  selectedOption: string | null;
  onSelect: (optionId: string) => void;
  onSubmit: () => void;
  attempt: QuizAttempt | undefined;
  showExplanation: boolean;
  /** Read-aloud support; omitted renders no listen controls. */
  speech: ReturnType<typeof useSpeech>;
  onReadFeedback?: (id: string, text: string) => void;
}

function QuizBody({
  quiz,
  t,
  selectedOption,
  onSelect,
  onSubmit,
  attempt,
  showExplanation,
  speech,
  onReadFeedback,
}: QuizBodyProps) {
  const answered = showExplanation && attempt !== undefined;
  return (
    <div className="quiz-body" role="group" aria-label={t('lesson.quiz_prompt')}>
      <p className="quiz-question">{quiz.question}</p>
      <fieldset className="quiz-options">
        <legend className="sr-only">{t('lesson.quiz_prompt')}</legend>
        {quiz.options.map((option) => {
          const isSelected = selectedOption === option.id;
          const isCorrectOption = option.id === quiz.correctOptionId;
          let className = 'quiz-option';
          if (isSelected) className += ' quiz-option-selected';
          if (answered && isSelected && isCorrectOption) className += ' quiz-option-correct';
          if (answered && isSelected && !isCorrectOption) className += ' quiz-option-wrong';
          // After a miss, mark the accepted answer too — otherwise the student
          // is told they were wrong but never sees what was right.
          if (answered && !isSelected && isCorrectOption) className += ' quiz-option-expected';
          return (
            <label key={option.id} className={className}>
              <input
                type="radio"
                name={`quiz-${quiz.questionId}`}
                value={option.id}
                checked={isSelected}
                disabled={answered}
                onChange={() => onSelect(option.id)}
              />
              <span>{option.text}</span>
            </label>
          );
        })}
      </fieldset>

      {!answered && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSubmit}
          disabled={!selectedOption}
        >
          {t('lesson.submit')}
        </button>
      )}

      {answered && attempt && (
        <div
          className={`quiz-feedback ${attempt.isCorrect ? 'is-correct' : 'is-wrong'}`}
          role="status"
        >
          <p className="feedback-verdict">
            <span aria-hidden="true">{attempt.isCorrect ? '✓' : '✗'}</span>{' '}
            {/* Not a template literal: `{t(...)}` inside backticks renders as
                the literal text, which is what this used to do. */}
            {attempt.isCorrect ? t('common.correct') : t('common.incorrect')}
          </p>

          {/* A wrong answer must show the right one, or the student has learned
              nothing beyond "you were wrong". */}
          {!attempt.isCorrect && (
            <p className="feedback-answer">
              <span className="feedback-answer-label">{t('lesson.right_answer')}</span>{' '}
              <strong>{quiz.options.find((o) => o.id === quiz.correctOptionId)?.text}</strong>
            </p>
          )}

          {quiz.explanation && (
            <p className="feedback-explanation">
              <span className="feedback-answer-label">{t('lesson.why')}</span>{' '}
              {quiz.explanation}
            </p>
          )}

          {onReadFeedback && speech.available && (
            <button
              type="button"
              className="btn btn-ghost feedback-listen"
              onClick={() =>
                onReadFeedback(
                  `feedback-${quiz.questionId}`,
                  buildFeedbackScript(quiz, attempt.isCorrect),
                )
              }
              aria-pressed={speech.speakingId === `feedback-${quiz.questionId}`}
            >
              {speech.speakingId === `feedback-${quiz.questionId}`
                ? `⏸ ${t('lesson.stop_listen')}`
                : `🔊 ${t('lesson.listen')}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The card's own words, for read-aloud. Returns null when there is nothing
 * meaningful to say (an image card with no caption, say) so the UI can hide
 * the button rather than reading a title and stopping.
 */
function cardReadableAloud(card: LessonCard): string | null {
  const parts: string[] = [];
  if (card.title) parts.push(card.title);
  switch (card.type) {
    case 'text':
    case 'summary':
      if (card.body) parts.push(card.body);
      break;
    case 'quiz':
      parts.push(card.question);
      for (const option of card.options) parts.push(option.text);
      break;
    case 'image':
      if (card.caption) parts.push(card.caption);
      break;
    default:
      break;
  }
  const text = parts.join('. ').trim();
  return text.length > 0 ? text : null;
}

/**
 * What the voice should read after an answer: the verdict, the accepted
 * answer when the student missed it, and the explanation. Read back as one
 * passage so it sounds like a tutor talking rather than three disconnected
 * fragments.
 */
function buildFeedbackScript(quiz: QuizCard, isCorrect: boolean): string {
  const right = quiz.options.find((o) => o.id === quiz.correctOptionId)?.text ?? '';
  const parts = [quiz.question];
  if (isCorrect) {
    parts.push('Correct.');
  } else {
    parts.push(`Not quite. The right answer is ${right}.`);
  }
  if (quiz.explanation) parts.push(quiz.explanation);
  return parts.join(' ');
}

/** Convenience wrapper used by app routing/tests. */
export default LessonViewer;