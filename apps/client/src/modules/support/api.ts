/**
 * Support API client — mentor questions and the AI tutor.
 *
 * Both calls carry the session bearer token so the server can tell a student
 * from a teacher. The AI key is never visible here; the browser only ever talks
 * to our own /api/v1/support/ask proxy.
 */

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api/v1') as string;
const TOKEN_KEY = 'edumitra.session';

export interface Mentor {
  id: string;
  display_name: string;
  class_id: string | null;
}

export interface MentorRequest {
  id: string;
  student_name: string;
  subject: string;
  body: string;
  status: string;
  created_at: number;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

function token(): string | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string };
    return parsed.token ?? null;
  } catch {
    return null;
  }
}

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const bearer = token();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`request_failed_${response.status}`);
  return (await response.json()) as T;
}

/** Whether the server has an AI provider configured. */
export async function supportStatus(): Promise<{ aiEnabled: boolean }> {
  try {
    return await authFetch<{ aiEnabled: boolean }>('/support/status');
  } catch {
    return { aiEnabled: false };
  }
}

export async function fetchMentors(): Promise<Mentor[]> {
  try {
    const body = await authFetch<{ mentors: Mentor[] }>('/support/mentors');
    return body.mentors;
  } catch {
    return [];
  }
}

export async function fetchMyRequests(): Promise<MentorRequest[]> {
  try {
    const body = await authFetch<{ requests: MentorRequest[] }>('/support/my-requests');
    return body.requests;
  } catch {
    return [];
  }
}

export async function sendMentorRequest(subject: string, body: string): Promise<void> {
  await authFetch<{ ok: boolean }>('/support/mentor-request', {
    method: 'POST',
    body: JSON.stringify({ subject, body }),
  });
}

export async function fetchMentorInbox(): Promise<MentorRequest[]> {
  const body = await authFetch<{ requests: MentorRequest[] }>('/support/mentor-requests');
  return body.requests;
}

export async function resolveMentorRequest(id: string): Promise<void> {
  await authFetch<{ ok: boolean }>('/support/mentor-request/resolve', {
    method: 'POST',
    body: JSON.stringify({ id, status: 'answered' }),
  });
}

/** Sends a question to the tutor. Throws `ai_unavailable` when not configured. */
export async function askTutor(
  message: string,
  history: ChatTurn[],
  context: { grade?: number; className?: string },
): Promise<string> {
  const response = await fetch(`${API_BASE}/support/ask`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token() ? { authorization: `Bearer ${token()}` } : {}),
    },
    body: JSON.stringify({ message, history, ...context }),
  });
  if (response.status === 503) throw new Error('ai_unavailable');
  if (!response.ok) throw new Error(`ask_failed_${response.status}`);
  const body = (await response.json()) as { answer: string };
  return body.answer;
}