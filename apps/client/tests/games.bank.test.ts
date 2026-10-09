/**
 * Game bank tests.
 *
 * The games are generated from lesson content, so these guard the properties
 * the UI relies on: a non-empty question bank, a correctIndex that actually
 * points at the right option, True/False items that read as propositions, and
 * deterministic shuffling when a seed is supplied.
 */

import { describe, expect, it } from 'vitest';
import {
  buildMemoryPairs,
  buildQuestionBank,
  buildTrueFalse,
  pickQuestions,
  shuffle,
} from '../src/games/bank';
import type { LessonRecord } from '../src/db/schema';

function lesson(overrides: Partial<LessonRecord> & { id: string }): LessonRecord {
  return {
    title: overrides.title ?? 'Linear Equations',
    grade: overrides.grade ?? 8,
    subject: overrides.subject ?? 'math',
    content_json: JSON.stringify({
      cards: [
        {
          id: 't1',
          type: 'text',
          title: 'A linear equation',
          body: 'An equation whose highest power of the variable is one.',
        },
        {
          id: 'q1',
          type: 'quiz',
          questionId: 'q1',
          question: 'What is the highest power in 3x + 5?',
          options: [
            { id: 'o1', text: 'zero' },
            { id: 'o2', text: 'one, so the equation is linear' },
            { id: 'o3', text: 'two' },
          ],
          correctOptionId: 'o2',
          explanation: 'The variable appears only to the first power.',
        },
      ],
    }),
    content_version: 1,
    updated_at: 0,
    created_at: 0,
    ...overrides,
  } as LessonRecord;
}

describe('buildQuestionBank', () => {
  it('turns quiz cards into questions with the correct answer in place', () => {
    const bank = buildQuestionBank([lesson({ id: 'l1' })]);
    expect(bank).toHaveLength(1);
    expect(bank[0]!.prompt).toBe('What is the highest power in 3x + 5?');
    expect(bank[0]!.options[bank[0]!.correctIndex]).toBe('one, so the equation is linear');
    expect(bank[0]!.lessonId).toBe('l1');
    expect(bank[0]!.hint).toBe('The variable appears only to the first power.');
  });

  it('skips a quiz card whose correctOptionId matches no option', () => {
    const broken = lesson({ id: 'l2' });
    const parsed = JSON.parse(broken.content_json) as {
      cards: Array<{ correctOptionId: string }>;
    };
    parsed.cards[1]!.correctOptionId = 'missing';
    broken.content_json = JSON.stringify(parsed);
    expect(buildQuestionBank([broken])).toHaveLength(0);
  });

  it('skips quiz cards with fewer than two options', () => {
    const thin = lesson({ id: 'l3' });
    const parsed = JSON.parse(thin.content_json) as {
      cards: Array<{ options: unknown }>;
    };
    parsed.cards[1]!.options = [{ id: 'o1', text: 'only one' }];
    thin.content_json = JSON.stringify(parsed);
    expect(buildQuestionBank([thin])).toHaveLength(0);
  });

  it('returns nothing for malformed content instead of throwing', () => {
    const bad = lesson({ id: 'l4', content_json: 'not json at all' });
    expect(buildQuestionBank([bad])).toHaveLength(0);
  });

  it('filters by grade and by subject', () => {
    const lessons = [
      lesson({ id: 'g8', grade: 8 }),
      lesson({ id: 'g9', grade: 9 }),
      lesson({ id: 'sci', subject: 'science', grade: 8 }),
    ];
    // Two lessons are Class 8 (one of them science), one is Class 9.
    expect(buildQuestionBank(lessons, { grade: 8 })).toHaveLength(2);
    expect(buildQuestionBank(lessons, { grade: 8, subject: 'math' })).toHaveLength(1);
    expect(buildQuestionBank(lessons, { grade: 9 })[0]!.lessonId).toBe('g9');
    expect(buildQuestionBank(lessons, { subject: 'science' })[0]!.lessonId).toBe('sci');
    expect(buildQuestionBank(lessons, { subject: 'sst' })).toHaveLength(0);
    expect(buildQuestionBank(lessons, { grade: 10 })).toHaveLength(0);
  });

  it('treats a non-numeric grade (practice) as ungraded rather than dropping it', () => {
    const practice = lesson({ id: 'p', grade: 'practice' });
    const bank = buildQuestionBank([practice]);
    expect(bank).toHaveLength(1);
    expect(bank[0]!.grade).toBeUndefined();
  });
});

describe('buildMemoryPairs', () => {
  it('uses the first text card title as the term and body as the definition', () => {
    const pairs = buildMemoryPairs([lesson({ id: 'l1' })]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.term).toBe('A linear equation');
    expect(pairs[0]!.definition).toContain('highest power');
  });

  it('truncates a long definition so it stays readable at a glance', () => {
    const long = lesson({ id: 'l2' });
    const parsed = JSON.parse(long.content_json) as { cards: Array<{ body: string }> };
    parsed.cards[0]!.body = 'x'.repeat(400);
    long.content_json = JSON.stringify(parsed);
    const [pair] = buildMemoryPairs([long]);
    expect(pair!.definition.length).toBeLessThanOrEqual(190);
    expect(pair!.definition.endsWith('…')).toBe(true);
  });

  it('skips a lesson with no text card', () => {
    const noText = lesson({ id: 'l3' });
    noText.content_json = JSON.stringify({
      cards: [
        {
          id: 'q1',
          type: 'quiz',
          questionId: 'q1',
          question: 'x?',
          options: [
            { id: 'a', text: 'yes it is' },
            { id: 'b', text: 'no it is not' },
          ],
          correctOptionId: 'a',
        },
      ],
    });
    expect(buildMemoryPairs([noText])).toHaveLength(0);
  });
});

describe('buildTrueFalse', () => {
  it('produces binary options with a correctIndex in range', () => {
    const items = buildTrueFalse([lesson({ id: 'l1' })]);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.options).toEqual(['True', 'False']);
      expect([0, 1]).toContain(item.correctIndex);
      expect(item.prompt.startsWith('True or false — ')).toBe(true);
    }
  });

  it('only builds a False item when the distractor reads as a claim', () => {
    // 'zero' and 'two' are too short to be propositions, so only the True item
    // (from the accepted answer) is produced.
    const items = buildTrueFalse([lesson({ id: 'l1' })]);
    expect(items).toHaveLength(1);
    expect(items[0]!.prompt).toContain('one, so the equation is linear');
    expect(items[0]!.correctIndex).toBe(0);
  });

  it('builds a False item when a distractor is phrased like an answer', () => {
    const prose = lesson({ id: 'l2' });
    prose.content_json = JSON.stringify({
      cards: [
        {
          id: 'q1',
          type: 'quiz',
          questionId: 'q1',
          question: 'Is the graph a straight line?',
          options: [
            { id: 'o1', text: 'yes, it is a straight line' },
            { id: 'o2', text: 'no, it is a curved parabola' },
          ],
          correctOptionId: 'o1',
        },
      ],
    });
    const items = buildTrueFalse([prose]);
    expect(items).toHaveLength(2);
    expect(items.filter((i) => i.correctIndex === 1)).toHaveLength(1);
    expect(items.filter((i) => i.correctIndex === 1)[0]!.prompt).toContain('parabola');
  });
});

describe('shuffle', () => {
  it('returns a permutation, not the same array', () => {
    const input = [1, 2, 3, 4, 5];
    const output = shuffle(input);
    expect(output).not.toBe(input);
    expect([...output].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  it('is deterministic when the same seed is replayed', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    // A fresh generator per call: both shuffles start from the same seed.
    const seeded = (): (() => number) => {
      let seed = 42;
      return () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
    };
    expect(shuffle(input, seeded())).toEqual(shuffle(input, seeded()));
  });

  it('handles empty and single-element input', () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(['only'])).toEqual(['only']);
  });
});

describe('pickQuestions', () => {
  const bank = buildQuestionBank([
    lesson({ id: 'a' }),
    lesson({ id: 'b' }),
    lesson({ id: 'c' }),
    lesson({ id: 'd' }),
  ]);

  it('returns at most n items, with no duplicates', () => {
    const picked = pickQuestions(bank, 2);
    expect(picked).toHaveLength(2);
    expect(new Set(picked.map((q) => q.id)).size).toBe(2);
  });

  it('returns everything when asked for more than the bank holds', () => {
    expect(pickQuestions(bank, 99)).toHaveLength(bank.length);
  });

  it('returns an empty list for an empty bank', () => {
    expect(pickQuestions([], 10)).toEqual([]);
  });
});