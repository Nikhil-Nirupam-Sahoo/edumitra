// @vitest-environment jsdom
/**
 * Game components — rendered against fake-indexeddb and the real store.
 *
 * The games are the most stateful screens in the app (timers, combo counters, a
 * two-card comparison window), so they get the same treatment as LessonViewer:
 * mounted for real and driven with real clicks. A hook placed after an early
 * return here would throw "Rendered more hooks than during the previous
 * render" — the failure mode that once blanked the lesson viewer.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { clearAllData, getMeta, upsertLessons } from '../src/db/client';
import type { LessonRecord } from '../src/db/schema';
import { QuizArena } from '../src/modules/games/QuizArena';
import { Reels } from '../src/modules/reels/Reels';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** REVEAL_MS is the 650 ms window an answer stays highlighted for. */
const REVEAL_MS = 300;

function lesson(id: string, title: string, question: string): LessonRecord {
  return {
    id,
    title,
    language: 'en',
    version: 2,
    updated_at: 1_700_000_000_000,
    grade: 8,
    subject: 'math',
    content_json: JSON.stringify({
      version: 2,
      language: 'en',
      cards: [
        {
          id: `${id}-t1`,
          type: 'text',
          title: `${title} explained`,
          body: 'A short explanation that the memory game pairs with the title.',
        },
        {
          id: `${id}-q1`,
          type: 'quiz',
          questionId: 'q1',
          question,
          options: [
            { id: 'a', text: 'yes, that is right' },
            { id: 'b', text: 'no, that is wrong' },
          ],
          correctOptionId: 'a',
          explanation: 'The first option is the accepted one.',
        },
      ],
    }),
  };
}

/** One real lesson id so the reels figure lookup has something to resolve. */
const LESSONS = [
  lesson('c8-math-linear-equations', 'Linear Equations', 'Is 3x + 5 linear?'),
  lesson('c8-math-rational-numbers', 'Rational Numbers', 'Is 1/3 rational?'),
  lesson('c8-math-triangles', 'Triangles', 'Do angles add to 180?'),
];

let container: HTMLDivElement;
let root: Root;

async function flush(ms = 40): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function click(text: string): void {
  const button = [...container.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes(text),
  );
  expect(button, `no button matching ${JSON.stringify(text)}`).toBeDefined();
  act(() => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await clearAllData();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderArena(): void {
  act(() => {
    root.render(<QuizArena studentId="stu-1" locale="en" />);
  });
}

describe('QuizArena', () => {
  it('survives loading → menu without a hook-order error', async () => {
    await upsertLessons(LESSONS);
    renderArena();
    await flush();

    expect(container.textContent ?? '').toContain('Game Arena');
    expect(container.textContent ?? '').toContain('3 questions from your syllabus');
    expect(container.textContent ?? '').toContain('Blitz');
    expect(container.textContent ?? '').toContain('Memory');
  });

  it('starts a sprint round with the question, its options and the source lesson', async () => {
    await upsertLessons(LESSONS);
    renderArena();
    await flush();

    click('Sprint');
    await flush();

    const text = container.textContent ?? '';
    // A sprint is capped at 10 questions; the bank only has 3, so all 3 are used.
    expect(text).toContain('1 / 3');
    expect(container.querySelectorAll('.arena-option').length).toBe(2);
    expect(text).toMatch(/Class 8/);
  });

  it('highlights the correct answer and banks the points before moving on', async () => {
    await upsertLessons(LESSONS);
    renderArena();
    await flush();
    click('Sprint');
    await flush();

    click('yes, that is right');
    await flush(REVEAL_MS);

    // Correct → the picked option is revealed as right, and the score moves.
    expect(container.querySelectorAll('.arena-option.right').length).toBe(1);
    expect(container.querySelectorAll('.arena-option.wrong').length).toBe(0);
    expect(container.textContent ?? '').toContain('Score 10');

    // Let the reveal lapse so the round advances and the score is written.
    await flush(500);
    expect(await getMeta('games.best.stu-1.sprint')).not.toBeUndefined();
  });

  it('highlights a wrong answer and breaks the combo', async () => {
    await upsertLessons(LESSONS);
    renderArena();
    await flush();
    click('Sprint');
    await flush();

    click('no, that is wrong');
    await flush(REVEAL_MS);

    expect(container.querySelectorAll('.arena-option.wrong').length).toBe(1);
    // The accepted answer is still shown, so the student learns from the miss.
    expect(container.querySelectorAll('.arena-option.right').length).toBe(1);
    expect(container.textContent ?? '').toContain('Score 0');
  });

  it('advances to the next question once the reveal lapses', async () => {
    await upsertLessons(LESSONS);
    renderArena();
    await flush();
    click('Sprint');
    await flush();

    const first = container.textContent ?? '';
    click('yes, that is right');
    await flush(900);

    const after = container.textContent ?? '';
    expect(after).not.toBe(first);
    expect(after).toContain('2 / 3');
  });

  it('ends the round on the last question and offers a replay', async () => {
    await upsertLessons(LESSONS);
    renderArena();
    await flush();
    click('Sprint');
    await flush();

    for (let i = 0; i < LESSONS.length; i += 1) {
      click('yes, that is right');
      await flush(900);
    }

    const text = container.textContent ?? '';
    expect(text).toMatch(/New best!|Round complete/);
    expect(text).toContain('3 correct out of 3');
    expect(text).toContain('Play again');
    expect(text).toContain('Change mode');
  });

  it('deals a memory grid of two cards per available pair', async () => {
    await upsertLessons(LESSONS);
    renderArena();
    await flush();

    click('Memory');
    await flush();

    // 3 lessons → 3 pairs → 6 cards (fewer than the 5-pair maximum).
    expect(container.querySelectorAll('.memory-card')).toHaveLength(LESSONS.length * 2);
    expect(container.textContent ?? '').toContain('Memory · 0/5');
  });

  it('flips two cards, counts a miss and turns them back over', async () => {
    await upsertLessons(LESSONS);
    renderArena();
    await flush();
    click('Memory');
    await flush();

    // The first two cards belong to different pairs in a shuffled deck only by
    // chance, so assert on the state transition rather than the outcome: after
    // one resolution either a match (done) or a miss must have registered.
    const facedown = [...container.querySelectorAll<HTMLButtonElement>('.memory-card')].filter(
      (c) => !c.disabled,
    );
    act(() => {
      facedown[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      facedown[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush(800);

    const matched = container.querySelectorAll('.memory-card.done').length;
    expect(matched % 2).toBe(0);
    expect(matched + Number((container.textContent ?? '').includes('1 misses'))).toBeGreaterThan(0);
  });

  it('shows an empty-library message and disables every mode', async () => {
    renderArena();
    await flush();

    const cards = [...container.querySelectorAll<HTMLButtonElement>('.arena-card')];
    expect(cards).toHaveLength(4);
    for (const card of cards) expect(card.disabled).toBe(true);
    expect(container.textContent ?? '').toContain('0 questions');
  });
});

describe('Reels', () => {
  it('renders one reel per lesson with its figure and quiz', async () => {
    await upsertLessons(LESSONS);
    act(() => {
      root.render(<Reels locale="en" onClose={() => {}} />);
    });
    await flush();

    const reels = container.querySelectorAll('.reel');
    expect(reels).toHaveLength(LESSONS.length);
    expect(reels[0]!.querySelector('.reel-art')).not.toBeNull();
    expect(container.textContent ?? '').toContain('Linear Equations explained');
    expect(container.textContent ?? '').toContain('Class 8 · Math');
  });

  it('reveals a quick-check question and grades the answer', async () => {
    await upsertLessons(LESSONS);
    act(() => {
      root.render(<Reels locale="en" onClose={() => {}} />);
    });
    await flush();

    click('Quick check');
    await flush();

    expect(container.querySelectorAll('.reel-opt').length).toBe(2);
    click('yes, that is right');
    await flush();

    expect(container.querySelectorAll('.reel-opt.right').length).toBe(1);
    expect(container.textContent ?? '').toContain('The first option is the accepted one.');
  });

  it('shows a loading state when there are no lessons yet', async () => {
    act(() => {
      root.render(<Reels locale="en" onClose={() => {}} />);
    });
    await flush();
    expect(container.textContent ?? '').toContain('Loading');
  });
});