/**
 * LoginScreen — the gate in front of the app.
 *
 * Doubles as a role picker: teachers and students get different credentials
 * and land on different dashboards. Demo credentials are offered as one-tap
 * fills so the app can be explored without typing.
 */

import { useCallback, useState } from 'react';
import type { AuthController } from './client';

const DEMO_ACCOUNTS = [
  { label: 'Teacher · Meera', username: 'meera', password: 'teach1234', emoji: '🧑‍🏫' },
  { label: 'Teacher · Rajesh', username: 'rajesh', password: 'teach1234', emoji: '👨‍🏫' },
  { label: 'Student · Aarav (Class 8)', username: 'aarav', password: 'learn1234', emoji: '🎒' },
  { label: 'Student · Rohan (Class 9)', username: 'rohan', password: 'learn1234', emoji: '📚' },
  { label: 'Student · Kabir (Class 10)', username: 'kabir', password: 'learn1234', emoji: '🎓' },
];

export function LoginScreen({ auth }: { auth: AuthController }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!username.trim() || !password || busy) return;
      setBusy(true);
      setError(null);
      try {
        await auth.signIn(username.trim(), password);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        setError(
          message === 'invalid_credentials'
            ? 'Wrong username or password.'
            : 'Could not reach the server. Check your connection and try again.',
        );
      } finally {
        setBusy(false);
      }
    },
    [auth, username, password, busy],
  );

  const fill = useCallback((u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError(null);
  }, []);

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">EduMitra</h1>
        <p className="login-subtitle">Sign in to start learning</p>

        <form onSubmit={submit} className="login-form">
          <label className="login-field">
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              placeholder="aarav"
            />
          </label>

          <label className="login-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary login-submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="login-demo">
          <p className="login-demo-label">Demo accounts — tap to fill</p>
          <div className="login-demo-grid">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.username}
                type="button"
                className="login-demo-chip"
                onClick={() => fill(account.username, account.password)}
              >
                <span className="login-demo-emoji" aria-hidden="true">
                  {account.emoji}
                </span>
                {account.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}