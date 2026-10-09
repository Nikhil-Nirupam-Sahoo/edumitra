/** Minimal fixture shape for content-pack lessons used by the client tests. */
export interface PackLesson {
  id: string;
  title: string;
  grade: number;
  subject: string;
  cards: Array<{
    id: string;
    type: string;
    title?: string;
    body?: string;
    questionId?: string;
    question?: string;
    options?: Array<{ id: string; text: string }>;
    correctOptionId?: string;
    explanation?: string;
  }>;
}