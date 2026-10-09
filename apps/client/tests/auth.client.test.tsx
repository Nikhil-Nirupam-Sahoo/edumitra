// @vitest-environment jsdom
/**
 * Auth client tests — session caching, role state and sign-out.
 *
 * The offline promise is the interesting part: a cached session must survive
 * a failed revalidation (no network) but be dropped when the server rejects
 * it (401). That distinction is what keeps a student working on a plane while
 * still letting an expired token log them out on a school Wi-Fi.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAuth, type AuthState, type SessionUser } from '../src/auth/client';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const STUDENT: SessionUser = {
  id: 'student-aarav',
  username: 'aarav',
  role: 'student',
  displayName: 'Aarav',
  classId: 'class-8-a',
  boardId: 'CBSE',
  schoolId: null,
  avatarUrl: null,
  fontSize: null,
};

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useAuth> | null = null;

function Probe() {
  latest = useAuth();
  return null;
}

async function flush(ms = 20): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function storeSession(session: unknown): void {
  localStorage.setItem('edumitra.session', JSON.stringify(session));
}

describe('useAuth', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    latest = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts signed out with nothing cached', () => {
    act(() => root.render(<Probe />));
    expect(latest!.state.status).toBe('signed-out');
    expect(latest!.isTeacher).toBe(false);
    expect(latest!.isStudent).toBe(false);
  });

  it('restores a cached session immediately, then revalidates', async () => {
    storeSession({ token: 'tok', user: STUDENT, checkedAt: 1 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ user: STUDENT }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    act(() => root.render(<Probe />));
    // Offline-first: usable immediately, before the server answers.
    expect(latest!.state.status).toBe('signed-in');

    await flush();
    expect(latest!.isStudent).toBe(true);
    expect(latest!.isTeacher).toBe(false);
  });

  it('keeps the cached session when the server is unreachable', async () => {
    storeSession({ token: 'tok', user: STUDENT, checkedAt: 1 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    act(() => root.render(<Probe />));
    await flush();
    // Offline: still signed in, so lessons keep working.
    expect(latest!.state.status).toBe('signed-in');
  });

  it('signs out when the server rejects the token (401)', async () => {
    storeSession({ token: 'stale', user: STUDENT, checkedAt: 1 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 })),
    );

    act(() => root.render(<Probe />));
    await flush();
    expect(latest!.state.status).toBe('signed-out');
    expect(localStorage.getItem('edumitra.session')).toBeNull();
  });

  it('adopts the role the SERVER reports, not the cached one', async () => {
    // Cached says student; the server promotes them to teacher.
    storeSession({ token: 'tok', user: STUDENT, checkedAt: 1 });
    const promoted: SessionUser = { ...STUDENT, role: 'teacher', classId: null, displayName: 'Aarav (now teacher)' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ user: promoted }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    act(() => root.render(<Probe />));
    await flush();
    expect(latest!.isTeacher).toBe(true);
  });

  it('signs in and caches the session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ user: STUDENT, token: 'fresh' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    act(() => root.render(<Probe />));
    await act(async () => {
      await latest!.signIn('aarav', 'learn1234');
    });

    const state = latest!.state as Extract<AuthState, { status: 'signed-in' }>;
    expect(state.user.username).toBe('aarav');
    expect(state.token).toBe('fresh');
    expect(JSON.parse(localStorage.getItem('edumitra.session') ?? '{}').token).toBe('fresh');
  });

  it('surfaces a 401 as invalid_credentials so the UI can show a message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_credentials' }), { status: 401 })),
    );

    act(() => root.render(<Probe />));
    await expect(latest!.signIn('aarav', 'wrong')).rejects.toThrow('invalid_credentials');
  });

  it('clears the cache on sign out', async () => {
    storeSession({ token: 'tok', user: STUDENT, checkedAt: 1 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ user: STUDENT }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    act(() => root.render(<Probe />));
    await flush();
    act(() => latest!.signOut());
    expect(latest!.state.status).toBe('signed-out');
    expect(localStorage.getItem('edumitra.session')).toBeNull();
  });

  it('ignores a corrupt cache entry instead of crashing', () => {
    localStorage.setItem('edumitra.session', '{not json');
    act(() => root.render(<Probe />));
    expect(latest!.state.status).toBe('signed-out');
  });
});