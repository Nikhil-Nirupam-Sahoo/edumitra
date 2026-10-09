/**
 * QuizArena — the mini-games screen.
 *
 * Four modes, all built from the syllabus content already on the device, so
 * every round is real revision rather than generic filler:
 *   Blitz      60 s rapid-fire; consecutive correct answers build a multiplier
 *   Sprint     10 questions, no clock; graded for accuracy
 *   True/False quick yes-or-no over the same question bank
 *   Memory     match each chapter's key idea to its explanation
 *
 * Scores are kept per student in the meta store (see games/scores.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LessonRecord } from '../../db/schema';
import { launchConfetti } from '../../gamification/confetti';
import { playCorrect, playLevelUp, playQuest, playWrong } from '../../gamification/sfx';
import { createTranslator, type LocaleCode } from '../../i18n';
import {
  buildMemoryPairs,
  buildQuestionBank,
  buildTrueFalse,
  loadLibrary,
  pickQuestions,
  shuffle,
  type GameQuestion,
  type MemoryPair,
} from '../../games/bank';
import { getAllBest, recordScore, type GameMode, type Score } from '../../games/scores';

interface QuizArenaProps {
  studentId: string;
  locale: LocaleCode;
}

const MODES: Array<{ id: GameMode; label: string; icon: string; blurb: string }> = [
  { id: 'blitz', label: 'Blitz', icon: '⚡', blurb: '60 seconds. Combo = more points.' },
  { id: 'sprint', label: 'Sprint', icon: '🏃', blurb: '10 questions, no clock.' },
  { id: 'truefalse', label: 'True or False', icon: '⚖️', blurb: 'Quick yes-or-no.' },
  { id: 'memory', label: 'Memory', icon: '🧠', blurb: 'Match each idea to its meaning.' },
];

const MODE_IDS = MODES.map((m) => m.id);

/** Blitz round length. */
const BLITZ_SECONDS = 60;

/** Combo multiplier: the first answer is worth 10, the fifth and beyond 50. */
const POINTS_PER_STEP = 10;
const MAX_MULTIPLIER = 5;

function pointsFor(comboLength: number): number {
  return POINTS_PER_STEP * Math.min(comboLength, MAX_MULTIPLIER);
}

export function QuizArena({ studentId, locale }: QuizArenaProps) {
  const { t } = createTranslator(locale);
  const [lessons, setLessons] = useState<LessonRecord[]>([]);
  const [mode, setMode] = useState<GameMode | null>(null);
  const [best, setBest] = useState<Partial<Record<GameMode, Score>>>({});
  const [loaded, setLoaded] = useState(false);
  /** Bumped on "Play again" so the round gets a fresh shuffle. */
  const [round, setRound] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [library, scores] = await Promise.all([
        loadLibrary(),
        getAllBest(studentId, MODE_IDS),
      ]);
      if (cancelled) return;
      setLessons(library);
      setBest(scores);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const refreshBest = useCallback(async () => {
    setBest(await getAllBest(studentId, MODE_IDS));
  }, [studentId]);

  const totalQuestions = useMemo(() => buildQuestionBank(lessons).length, [lessons]);

  // Derived unconditionally — a hook inside a conditional return is the same
  // hook-order bug that blanked the lesson viewer once.
  const roundQuestions = useMemo(() => {
    if (mode === 'truefalse') return pickQuestions(buildTrueFalse(lessons), 12);
    if (mode === 'blitz') return pickQuestions(buildQuestionBank(lessons), 40);
    if (mode === 'sprint') return pickQuestions(buildQuestionBank(lessons), 10);
    return [];
  }, [lessons, mode, round]);

  const memoryPairs = useMemo(() => buildMemoryPairs(lessons), [lessons, round]);

  if (mode === null) {
    return (
      <div className="arena">
        <header className="arena-header">
          <h2>🎮 {t('games.title')}</h2>
          <p className="muted">
            {loaded
              ? t('games.count', { count: totalQuestions })
              : t('common.loading')}
          </p>
        </header>

        <div className="arena-grid">
          {MODES.map((m) => {
            const score = best[m.id];
            return (
              <button
                key={m.id}
                type="button"
                className="arena-card"
                onClick={() => {
                  setRound((r) => r + 1);
                  setMode(m.id);
                }}
                disabled={!loaded || lessons.length === 0}
              >
                <span className="arena-icon" aria-hidden="true">
                  {m.icon}
                </span>
                <span className="arena-name">{m.label}</span>
                <span className="arena-blurb">{m.blurb}</span>
                {score && (
                  <span className="arena-best">
                    best {score.score} · {score.correct}/{score.total}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <p className="muted arena-source">{t('games.offline_note')}</p>
        <button
          type="button"
          className="btn btn-secondary arena-back"
          onClick={() => history.back()}
        >
          {t('games.back_to_menu')}
        </button>
      </div>
    );
  }

  if (mode === 'memory') {
    return (
      <MemoryGame
        key={`memory-${round}`}
        studentId={studentId}
        locale={locale}
        pairs={memoryPairs}
        onExit={() => setMode(null)}
        onReplay={() => setRound((r) => r + 1)}
        onScored={refreshBest}
      />
    );
  }

  return (
    <QuizRound
      key={`${mode}-${round}`}
      studentId={studentId}
      locale={locale}
      mode={mode}
      questions={roundQuestions}
      onExit={() => setMode(null)}
      onReplay={() => setRound((r) => r + 1)}
      onScored={refreshBest}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Quiz round (blitz / sprint / true-false)                                   */
/* -------------------------------------------------------------------------- */

function QuizRound({
  studentId,
  locale,
  mode,
  questions,
  onExit,
  onReplay,
  onScored,
}: {
  studentId: string;
  locale: LocaleCode;
  mode: GameMode;
  questions: GameQuestion[];
  onExit: () => void;
  onReplay: () => void;
  onScored: () => Promise<void>;
}) {
  const { t } = createTranslator(locale);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(mode === 'blitz' ? BLITZ_SECONDS : 0);
  const [finished, setFinished] = useState(false);
  const [newBest, setNewBest] = useState(false);
  const startedAt = useRef(Date.now());

  const question = questions[index];

  // Round totals live in a ref so the finish handler always sees the final
  // numbers without having to be re-created (and re-armed) on every answer.
  const totals = useRef({ correct: 0, answered: 0, score: 0 });
  totals.current = { correct, answered, score };

  const finish = useCallback(
    async (elapsedMs: number) => {
      const final = totals.current;
      // Speed bonus: up to +25% for a quick round, floored so a fast but
      // accurate round isn't punished.
      const bonus = Math.round(
        final.score * Math.min(0.25, 1500 / Math.max(elapsedMs, 2000)),
      );
      const total = final.score + bonus;
      const beat = await recordScore(studentId, mode, {
        score: total,
        correct: final.correct,
        total: Math.max(final.answered, 1),
      });
      setScore(total);
      setNewBest(beat);
      setFinished(true);
      await onScored();
      if (beat) {
        launchConfetti({ durationMs: 1800, particleCount: 110 });
        playLevelUp();
      }
    },
    [mode, studentId, onScored],
  );

  // Blitz countdown. The finish is triggered by a separate effect on
  // timeLeft === 0 — calling it inside the state updater would be a side
  // effect in a function that must stay pure.
  useEffect(() => {
    if (mode !== 'blitz') return;
    const id = window.setInterval(() => setTimeLeft((prev) => Math.max(prev - 1, 0)), 1000);
    return () => window.clearInterval(id);
  }, [mode]);

  useEffect(() => {
    if (mode === 'blitz' && timeLeft === 0 && !finished) {
      void finish(BLITZ_SECONDS * 1000);
    }
  }, [mode, timeLeft, finished, finish]);

  const answer = useCallback(
    (optionIndex: number) => {
      if (picked !== null || !question || finished) return;
      setPicked(optionIndex);
      const right = optionIndex === question.correctIndex;
      const nextCombo = right ? combo + 1 : 0;
      const gained = right ? pointsFor(nextCombo) : 0;

      if (right) {
        setBestCombo((b) => Math.max(b, nextCombo));
        playCorrect(nextCombo);
      } else {
        playWrong();
      }
      setCombo(nextCombo);
      setCorrect((c) => c + (right ? 1 : 0));
      setAnswered((a) => a + 1);
      setScore((s) => s + gained);

      window.setTimeout(() => {
        setPicked(null);
        if (index + 1 >= questions.length) {
          void finish(Date.now() - startedAt.current);
        } else {
          setIndex((i) => i + 1);
        }
      }, 650);
    },
    [picked, question, finished, combo, index, questions.length, finish],
  );

  if (finished) {
    return (
      <div className="arena-result">
        <h2>{newBest ? `🏆 ${t('games.new_best')}` : t('games.round_complete')}</h2>
        <p className="arena-score">{score}</p>
        <p className="muted">
          {t('games.summary', { correct, total: Math.max(answered, 1), combo: bestCombo })}
        </p>
        <div className="arena-result-actions">
          <button type="button" className="btn btn-primary" onClick={onReplay}>
            {t('games.play_again')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onExit}
            style={{ marginLeft: '0.5rem' }}
          >
            {t('games.change_mode')}
          </button>
        </div>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="arena">
        <p className="muted">{t('games.no_questions')}</p>
        <button type="button" className="btn btn-secondary" onClick={onExit}>
          {t('games.back_to_menu')}
        </button>
      </div>
    );
  }

  return (
    <div className="arena">
      <header className="arena-header arena-round">
        <button type="button" className="btn btn-ghost" onClick={onExit}>
          ← {t('games.exit')}
        </button>
        <span className="arena-progress">
          {index + 1} / {questions.length}
        </span>
        {mode === 'blitz' ? (
          <span className={`arena-timer ${timeLeft <= 10 ? 'urgent' : ''}`}>{timeLeft}s</span>
        ) : (
          <span className="arena-timer">{score}</span>
        )}
      </header>

      <div className="arena-scorebar">
        <span>{t('games.score', { score })}</span>
        {combo >= 2 && <span className="arena-combo">🔥 ×{combo}</span>}
      </div>

      <p className="arena-question">{question.prompt}</p>

      <div className="arena-options">
        {question.options.map((option, i) => {
          const chosen = picked === i;
          const isRight = i === question.correctIndex;
          const show = picked !== null && (chosen || isRight);
          return (
            <button
              key={i}
              type="button"
              className={`arena-option ${chosen ? 'picked' : ''} ${
                show && isRight ? 'right' : ''
              } ${show && chosen && !isRight ? 'wrong' : ''}`}
              onClick={() => answer(i)}
              disabled={picked !== null}
            >
              {option}
            </button>
          );
        })}
      </div>

      {picked !== null && question.hint && (
        <p className={`arena-hint ${picked === question.correctIndex ? 'good' : 'bad'}`}>
          {question.hint}
        </p>
      )}
      <p className="arena-source muted">
        {question.lessonTitle}
        {question.grade ? ` · Class ${question.grade}` : ''}
      </p>
    </div>
  );
}


/* -------------------------------------------------------------------------- */
/* Memory match                                                               */
/* -------------------------------------------------------------------------- */

const MEMORY_PAIRS = 5;

interface MemoryCard {
  id: string;
  pairId: string;
  face: string;
  faceUp: boolean;
  done: boolean;
}

function MemoryGame({
  studentId,
  locale,
  pairs,
  onExit,
  onReplay,
  onScored,
}: {
  studentId: string;
  locale: LocaleCode;
  pairs: MemoryPair[];
  onExit: () => void;
  onReplay: () => void;
  onScored: () => Promise<void>;
}) {
  const { t } = createTranslator(locale);
  const [cards, setCards] = useState<MemoryCard[]>([]);
  /** Ids flipped this turn; a third tap is ignored until the pair resolves. */
  const [picked, setPicked] = useState<string[]>([]);
  const [moves, setMoves] = useState(0);
  const [matches, setMatches] = useState(0);
  const [won, setWon] = useState(false);

  // Deal MEMORY_PAIRS pairs (two cards each) once per mount.
  useEffect(() => {
    const chosen = shuffle(pairs).slice(0, MEMORY_PAIRS);
    const deck = chosen.flatMap((pair) => [
      {
        id: `${pair.id}:t`,
        pairId: pair.id,
        face: pair.term,
        faceUp: false,
        done: false,
      },
      {
        id: `${pair.id}:d`,
        pairId: pair.id,
        face: pair.definition,
        faceUp: false,
        done: false,
      },
    ]);
    setCards(shuffle(deck));
  }, [pairs]);

  const flip = useCallback((id: string) => {
    setPicked((prev) => {
      if (prev.length >= 2 || prev.includes(id)) return prev;
      setCards((current) =>
        current.map((c) => (c.id === id && !c.done ? { ...c, faceUp: true } : c)),
      );
      return [...prev, id];
    });
  }, []);

  // Resolve the pair once two cards are face up.
  useEffect(() => {
    if (picked.length !== 2) return;
    const [aId, bId] = picked as [string, string];
    const pairId = cards.find((c) => c.id === aId)?.pairId;
    const matched = pairId !== undefined && pairId === cards.find((c) => c.id === bId)?.pairId;
    const id = window.setTimeout(() => {
      if (matched) {
        setCards((prev) => prev.map((c) => (c.pairId === pairId ? { ...c, done: true } : c)));
        setMatches((m) => m + 1);
        playQuest();
      } else {
        setCards((prev) =>
          prev.map((c) => (c.id === aId || c.id === bId ? { ...c, faceUp: false } : c)),
        );
        setMoves((m) => m + 1);
        playWrong();
      }
      setPicked([]);
    }, 700);
    return () => window.clearTimeout(id);
  }, [picked, cards]);

  useEffect(() => {
    if (cards.length > 0 && matches === MEMORY_PAIRS && !won) {
      setWon(true);
      launchConfetti({ durationMs: 1600, particleCount: 90 });
      void recordScore(studentId, 'memory', {
        score: Math.max(10, MEMORY_PAIRS * 10 - moves * 2),
        correct: matches,
        total: MEMORY_PAIRS,
      }).then(onScored);
    }
  }, [matches, cards.length, moves, studentId, onScored, won]);

  if (pairs.length === 0) {
    return (
      <div className="arena">
        <p className="muted">{t('games.too_few')}</p>
        <button type="button" className="btn btn-secondary" onClick={onExit}>
          {t('games.back_to_menu')}
        </button>
      </div>
    );
  }

  return (
    <div className="arena">
      <header className="arena-header arena-round">
        <button type="button" className="btn btn-ghost" onClick={onExit}>
          ← {t('games.exit')}
        </button>
        <span className="arena-progress">
          {t('games.progress', { matches, total: MEMORY_PAIRS })}
        </span>
        <span className="arena-timer">{t('games.misses', { moves })}</span>
      </header>

      <div className="memory-grid">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className={`memory-card ${card.faceUp || card.done ? 'up' : ''} ${
              card.done ? 'done' : ''
            }`}
            onClick={() => flip(card.id)}
            disabled={card.faceUp || card.done}
          >
            <span className="memory-face">{card.face}</span>
          </button>
        ))}
      </div>

      {won && (
        <div className="arena-result">
          <h2>🧠 {t('games.cleared')}</h2>
          <p className="muted">{t('games.cleared_summary', { matches, moves })}</p>
          <div className="arena-result-actions">
            <button type="button" className="btn btn-primary" onClick={onReplay}>
              {t('games.deal_again')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onExit}
              style={{ marginLeft: '0.5rem' }}
            >
              {t('games.change_mode')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}