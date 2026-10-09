// @vitest-environment jsdom
/**
 * LessonViewer component test — runs the real component through the real
 * loading → ready transition against fake-indexeddb.
 *
 * Regression guard for a Rules-of-Hooks violation that shipped once: the art
 * seed `useMemo` sat *below* the early returns, so it was skipped on the
 * first render (lesson still loading) and called on the next one. React
 * rejected that with "Rendered more hooks than during the previous render" and
 * the lesson never appeared — the symptom users described as "I open a topic
 * and it just doesn't load".
 *
 * Any hook placed after an early return will fail this test.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { clearAllData, upsertLessons } from '../src/db/client';
import { LessonViewer } from '../src/modules/lesson/LessonViewer';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const LESSON = {
  id: 'c8-math-rational-numbers',
  title: 'Rational Numbers',
  language: 'en',
  version: 2,
  updated_at: 1_700_000_000_000,
  grade: 8 as const,
  subject: 'math' as const,
  content_json: JSON.stringify({
    version: 2,
    language: 'en',
    cards: [
      { id: 'c1', type: 'text', title: 'What is a rational number?', body: 'A number written as p/q, where q is not 0.' },
      {
        id: 'c2',
        type: 'quiz',
        questionId: 'q1',
        question: 'Which of these is a rational number?',
        options: [
          { id: 'a', text: '1/3' },
          { id: 'b', text: '√2' },
        ],
        correctOptionId: 'a',
        explanation: '1/3 is a ratio of two integers.',
      },
      { id: 'c3', type: 'summary', title: '🌟', body: 'A rational number is p/q with q not 0.' },
    ],
  }),
};

let container: HTMLDivElement;
let root: Root;

async function flush(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function render(lessonId: string): void {
  act(() => {
    root.render(
      <LessonViewer lessonId={lessonId} studentId="stu-1" locale="en" onExit={() => {}} />,
    );
  });
}

describe('LessonViewer', () => {
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

  it('survives the loading → ready transition and renders the lesson', async () => {
    await upsertLessons([LESSON]);

    render(LESSON.id);
    // The very first render is the loading state; the IndexedDB read resolves
    // within this flush and re-renders as 'ready'. If the hook order changed
    // between those renders, React throws and the test fails here.
    await flush();

    expect(container.textContent ?? '').toContain('Rational Numbers');
    expect(container.textContent ?? '').toContain('What is a rational number?');
    expect(container.querySelector('.lesson-art')).not.toBeNull();
  });

  it('renders the quiz card when navigating to it', async () => {
    await upsertLessons([LESSON]);
    render(LESSON.id);
    await flush();

    const next = [...container.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Next'),
    );
    expect(next).toBeDefined();

    await act(async () => {
      next!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(container.textContent ?? '').toContain('Which of these is a rational number?');
    expect(container.querySelectorAll('input[type="radio"]').length).toBe(2);
  });

  it('shows a not-found message instead of crashing on a missing lesson', async () => {
    render('does-not-exist');
    await flush();
    expect(container.textContent ?? '').toContain('No lessons downloaded yet');
  });
});