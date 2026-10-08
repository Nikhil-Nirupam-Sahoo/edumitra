/**
 * Lesson content model (stored as `content_json` in the local `lessons` table).
 *
 * Content is intentionally CARDS + INTERACTIONS only — no executable lesson
 * code — which keeps payloads small (2G-friendly), keeps rendering deterministic
 * across devices, and avoids shipping a runtime interpreter to cheap hardware.
 * cmi5/xAPI semantics are preserved through the companion statements emitted by
 * LessonViewer via xapiLogger.
 */

export type CardType = 'text' | 'image' | 'audio' | 'quiz' | 'summary';

export interface BaseCard {
  id: string;
  type: CardType;
  /** Key into the local i18n bundle OR literal text (literal wins if present). */
  title?: string;
  titleKey?: string;
  /** ALT/description for accessibility and low-literacy talkback. */
  audioCue?: string;
}

export interface TextCard extends BaseCard {
  type: 'text';
  body: string;
}

export interface ImageCard extends BaseCard {
  type: 'image';
  /** Local /media path, WebP expected, dimensions declared to avoid layout shift. */
  imageUrl: string;
  width: number;
  height: number;
  caption?: string;
}

export interface AudioCard extends BaseCard {
  type: 'audio';
  audioUrl: string;
  transcript?: string;
}

export interface QuizOption {
  id: string;
  text: string;
}

export interface QuizCard extends BaseCard {
  type: 'quiz';
  question: string;
  questionId: string;
  options: QuizOption[];
  correctOptionId: string;
  explanation?: string;
}

export interface SummaryCard extends BaseCard {
  type: 'summary';
  body: string;
}

export type LessonCard = TextCard | ImageCard | AudioCard | QuizCard | SummaryCard;

export interface LessonContent {
  version: number;
  language: string;
  /** Optional cmi5 AU id for LMS-side registration. */
  auId?: string;
  cards: LessonCard[];
}

export interface Lesson {
  id: string;
  title: string;
  language: string;
  version: number;
  content: LessonContent;
}

/** Runtime parse with validation — corrupt content must never crash a lesson. */
export function parseLessonContent(contentJson: string, lessonId: string): LessonContent {
  try {
    const parsed = JSON.parse(contentJson) as Partial<LessonContent>;
    if (!parsed || !Array.isArray(parsed.cards)) {
      return { version: 0, language: 'en', cards: [] };
    }
    const cards = parsed.cards.filter(
      (card): card is LessonCard =>
        typeof card === 'object' &&
        card !== null &&
        typeof (card as { id?: unknown }).id === 'string' &&
        typeof (card as { type?: unknown }).type === 'string',
    );
    return {
      version: typeof parsed.version === 'number' ? parsed.version : 0,
      language: typeof parsed.language === 'string' ? parsed.language : 'en',
      auId: parsed.auId,
      cards,
    };
  } catch (error) {
    console.warn(`[lesson] corrupt content for ${lessonId}`, error);
    return { version: 0, language: 'en', cards: [] };
  }
}

export function quizCardsOf(content: LessonContent): QuizCard[] {
  return content.cards.filter((card): card is QuizCard => card.type === 'quiz');
}
