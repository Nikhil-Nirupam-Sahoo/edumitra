/**
 * Auth client — login, cached session, and role state.
 *
 * The token is kept on the device so the PWA stays usable offline (this is the
 * whole point of an offline-first classroom app), and re-validated against
 * /auth/me whenever a connection is available. Role is read from the server;
 * the client only uses it to decide which screens to show — the server
 * re-checks every gated route.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api/v1') as string;
const TOKEN_KEY = 'edumitra.session';

export type Role = 'student' | 'teacher';

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
  displayName: string;
  classId: string | null;
}

interface StoredSession {
  token: string;
  user: SessionUser;
  /** When we last confirmed the token with the server. */
  checkedAt: number;
}

export type AuthState =
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: SessionUser; token: string };

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.token || !parsed?.user?.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(session: StoredSession | null): void {
  try {
    if (session) localStorage.setItem(TOKEN_KEY, JSON.stringify(session));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode — session lives for this page only */
  }
}

export async function loginRequest(
  username: string,
  password: string,
): Promise<{ user: SessionUser; token: string }> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (response.status === 401) throw new Error('invalid_credentials');
  if (!response.ok) throw new Error(`login_failed_${response.status}`);
  return (await response.json()) as { user: SessionUser; token: string };
}

export interface AuthController {
  state: AuthState;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  isTeacher: boolean;
  isStudent: boolean;
}

export function useAuth(): AuthController {
  const [state, setState] = useState<AuthState>(() => {
    const stored = readStored();
    return stored
      ? { status: 'signed-in', user: stored.user, token: stored.token }
      : { status: 'signed-out' };
  });

  /** Confirm a cached token with the server; drop it if the server rejects. */
  const revalidate = useCallback(async (token: string, user: SessionUser) => {
    try {
      const response = await fetch(`${API_BASE}/auth/me`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        writeStored(null);
        setState({ status: 'signed-out' });
        return;
      }
      if (response.ok) {
        const body = (await response.json()) as { user: SessionUser };
        // Server is authoritative about role/name.
        writeStored({ token, user: body.user, checkedAt: Date.now() });
        setState({ status: 'signed-in', user: body.user, token });
      }
    } catch {
      // Offline: keep the cached session so the app still works.
    }
  }, []);

  useEffect(() => {
    const stored = readStored();
    if (stored) void revalidate(stored.token, stored.user);
  }, [revalidate]);

  const signIn = useCallback(async (username: string, password: string) => {
    const result = await loginRequest(username, password);
    writeStored({ token: result.token, user: result.user, checkedAt: Date.now() });
    setState({ status: 'signed-in', user: result.user, token: result.token });
  }, []);

  const signOut = useCallback(() => {
    writeStored(null);
    setState({ status: 'signed-out' });
  }, []);

  return useMemo(
    () => ({
      state,
      signIn,
      signOut,
      isTeacher: state.status === 'signed-in' && state.user.role === 'teacher',
      isStudent: state.status === 'signed-in' && state.user.role === 'student',
    }),
    [state, signIn, signOut],
  );
}