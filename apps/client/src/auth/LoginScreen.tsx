/**
 * LoginScreen — the gate in front of the app.
 *
 * Sign in with an account, create one, or use Google. Teachers and students get
 * different dashboards, and the demo accounts are offered as one-tap fills so
 * the app can be explored without typing.
 *
 * Which options actually appear is driven by `/auth/providers`: the Google
 * button is only rendered when a client id is configured, and the role choice on
 * sign-up only appears when the deployment allows teacher accounts. A button
 * that cannot work is worse than no button.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthController } from './client';
import { renderGoogleButton } from './google';

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api/v1') as string;

const DEMO_ACCOUNTS = [
  { label: 'Teacher · Meera', username: 'meera', password: 'teach1234', emoji: '🧑‍🏫' },
  { label: 'Teacher · Rajesh', username: 'rajesh', password: 'teach1234', emoji: '👨‍🏫' },
  { label: 'Student · Aarav (Class 8)', username: 'aarav', password: 'learn1234', emoji: '🎒' },
  { label: 'Student · Rohan (Class 9)', username: 'rohan', password: 'learn1234', emoji: '📚' },
  { label: 'Student · Kabir (Class 10)', username: 'kabir', password: 'learn1234', emoji: '🎓' },
];

interface Providers {
  password: boolean;
  google: string | null;
  allowTeacherSignup: boolean;
}

type Mode = 'signin' | 'signup';

export function LoginScreen({ auth }: { auth: AuthController }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [wantsTeacher, setWantsTeacher] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<Providers | null>(null);

  const googleSlot = useRef<HTMLDivElement | null>(null);

  // Ask the server what it actually supports, so the form never offers a path
  // that will be refused.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/auth/providers`, { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<Providers>) : null))
      .then((body) => {
        if (!cancelled && body) setProviders(body);
      })
      .catch(() => {
        // Offline or unavailable: password sign-in still works, so stay
        // optimistic rather than locking the form.
        if (!cancelled) setProviders({ password: true, google: null, allowTeacherSignup: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Google's button is rendered into a real DOM node, so the canvas has to exist
  // before the mode switches to the one that shows it.
  useEffect(() => {
    if (mode !== 'signin' || !providers?.google || !googleSlot.current) return;
    let disposed: (() => void) | undefined;
    renderGoogleButton(googleSlot.current, {
      clientId: providers.google,
      onCredential: ({ idToken }) => {
        setBusy(true);
        setError(null);
        void auth
          .signInWithGoogle(idToken)
          .catch((err: unknown) => {
            setError(describeGoogleError(err));
            setBusy(false);
          });
      },
      onError: () => {
        setError('Google sign-in was cancelled.');
      },
    })
      .then((dispose) => {
        disposed = dispose;
      })
      .catch(() => {
        // The GIS script could not load (offline, blocked). The button is
        // simply absent, and the password form still works.
        if (googleSlot.current) googleSlot.current.replaceChildren();
      });
    return () => disposed?.();
  }, [mode, providers?.google, auth]);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy) return;

      if (mode === 'signin') {
        if (!username.trim() || !password) return;
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
          await auth.signIn(username.trim(), password);
        } catch (err) {
          setError(describeSignInError(err));
        } finally {
          setBusy(false);
        }
        return;
      }

      // Sign-up runs through the same client-side guardrails the server will
      // apply, so obvious mistakes never cost a round-trip.
      const name = username.trim().toLowerCase();
      if (name.length < 3) {
        setError('Pick a username of at least 3 characters.');
        return;
      }
      if (displayName.trim().length < 2) {
        setError('Tell us your name.');
        return;
      }
      if (password.length < 8) {
        setError('Use a password of at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Those passwords do not match.');
        return;
      }

      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await auth.signUp({
          username: name,
          password,
          displayName: displayName.trim(),
          role: wantsTeacher ? 'teacher' : 'student',
        });
        setNotice('Account created — you are signed in.');
      } catch (err) {
        setError(describeSignUpError(err, wantsTeacher));
      } finally {
        setBusy(false);
      }
    },
    [auth, mode, username, password, confirmPassword, displayName, wantsTeacher, busy],
  );

  const fill = useCallback((u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setMode('signin');
    setError(null);
    setNotice(null);
  }, []);

  const switchMode = useCallback((next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setConfirmPassword('');
  }, []);

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">EduMitra</h1>
        <p className="login-subtitle">
          {mode === 'signin' ? 'Sign in to start learning' : 'Create your account'}
        </p>

        <form onSubmit={submit} className="login-form">
          {mode === 'signup' && (
            <label className="login-field">
              <span>Your name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                maxLength={60}
                placeholder="Aarav Kulkarni"
              />
            </label>
          )}

          <label className="login-field">
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={30}
              placeholder="aarav"
            />
          </label>

          <label className="login-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder="••••••••"
            />
          </label>

          {mode === 'signup' && (
            <>
              <label className="login-field">
                <span>Confirm password</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </label>

              {/* Only offered when the deployment allows it — otherwise this
                  would be a checkbox that always fails on submit. */}
              {providers?.allowTeacherSignup && (
                <label className="login-role">
                  <input
                    type="checkbox"
                    checked={wantsTeacher}
                    onChange={(e) => setWantsTeacher(e.target.checked)}
                  />
                  <span>I am a teacher</span>
                </label>
              )}
            </>
          )}

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="login-notice" role="status">
              {notice}
            </p>
          )}

          <button type="submit" className="btn btn-primary login-submit" disabled={busy}>
            {busy
              ? 'Please wait…'
              : mode === 'signin'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>

        <button type="button" className="login-switch" onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'No account? Create one' : 'Already have an account? Sign in'}
        </button>

        {mode === 'signin' && providers?.google && (
          <div className="login-google">
            <div className="login-divider">
              <span>or</span>
            </div>
            {/* Google renders its own button here. */}
            <div className="login-google-slot" ref={googleSlot} />
          </div>
        )}

        {mode === 'signin' && (
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
        )}
      </div>
    </div>
  );
}

function describeSignInError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'unknown';
  if (message === 'invalid_credentials') return 'Wrong username or password.';
  return 'Could not reach the server. Check your connection and try again.';
}

function describeSignUpError(err: unknown, wantsTeacher: boolean): string {
  const message = err instanceof Error ? err.message : 'unknown';
  if (message === 'username_taken') return 'That username is already taken.';
  if (message === 'role_not_allowed') {
    return wantsTeacher
      ? 'Teacher accounts are created by an administrator on this server.'
      : 'That account could not be created.';
  }
  return 'Could not reach the server. Check your connection and try again.';
}

function describeGoogleError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'unknown';
  if (message === 'audience_mismatch') {
    return 'This Google configuration does not match the server. Ask an administrator.';
  }
  if (message === 'email_unverified') {
    return 'Your Google account has no verified email address.';
  }
  if (message === 'invalid_token') return 'Google sign-in failed. Try again.';
  return 'Google sign-in is unavailable right now. Use your username and password instead.';
}
