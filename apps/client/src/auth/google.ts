/**
 * Google sign-in client.
 *
 * The Google Identity Services script is loaded LAZILY and only when a client
 * id is configured. That matters for an offline-first PWA: a remote script in
 * the initial render would be a third-party request on every cold start, and a
 * hanging one would block the login screen. Loading it on demand means an
 * unconfigured deployment never fetches anything.
 *
 * What the browser sends back is a Google *ID token* — a signed assertion about
 * who the user is. It is not a credential until our server has verified it and
 * swapped it for one of our own sessions, so it is only ever a one-shot value
 * handed straight to /auth/google.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';

let loader: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src^="${GIS_SRC}"]`);
    if (existing) {
      // Already present (loaded by a previous mount, or preloaded).
      if ((window as unknown as { google?: unknown }).google) resolve();
      else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('gis_load_failed')), {
          once: true,
        });
      }
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('gis_load_failed')), { once: true });
    document.head.appendChild(script);
  });
  return loader;
}

export interface GoogleCredential {
  /** The ID token, posted to the server for verification. */
  idToken: string;
}

export interface GoogleSignInOptions {
  clientId: string;
  onCredential: (credential: GoogleCredential) => void;
  onError: (error: Error) => void;
  /** Rendered in the Google popup's header. */
  buttonText?: 'signin_with' | 'signup_with';
}

/**
 * Renders Google's button into `container` and wires the credential callback.
 *
 * The button is Google's own markup on purpose — its font, branding and
 * accessibility treatment are all covered by Google's design guidelines.
 */
export async function renderGoogleButton(
  container: HTMLElement,
  options: GoogleSignInOptions,
): Promise<() => void> {
  try {
    await loadScript();
  } catch {
    throw new Error('gis_unavailable');
  }

  const api = (window as unknown as { google?: GoogleIdentityApi }).google;
  if (!api?.accounts?.id) throw new Error('gis_unavailable');

  // A blank each render: leaving the previous button would stack up on re-render.
  container.replaceChildren();

  api.accounts.id.initialize({
    client_id: options.clientId,
    callback: (response: { credential?: string }) => {
      if (!response.credential) {
        options.onError(new Error('no_credential'));
        return;
      }
      options.onCredential({ idToken: response.credential });
    },
  });

  api.accounts.id.renderButton(container, {
    theme: 'filled_black',
    size: 'large',
    shape: 'pill',
    text: options.buttonText ?? 'signin_with',
    logo_alignment: 'center',
    width: container.clientWidth || 280,
  });

  return () => {
    try {
      api.accounts.id.cancel?.();
    } catch {
      // Nothing to cancel.
    }
    container.replaceChildren();
  };
}

interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
      }): void;
      renderButton(
        element: HTMLElement,
        config: Record<string, unknown>,
      ): void;
      cancel?: () => void;
    };
  };
}