import { canonicalRequest, forgetDevice, publicKeyB64, sign } from './device';

/**
 * The only way this site talks to the service.
 *
 * Two jobs, both security-relevant:
 *   1. sign every request with the device key, over the exact bytes sent
 *   2. flatten every outcome into a Failure, so nothing above this file can
 *      accidentally render a diagnostic
 *
 * Requests are relative (`/api/v1/...`) because the site and the service are
 * always served from one origin.
 */

const API = '/api/v1';

/** Everything that can go wrong, as far as the person using this is concerned. */
export type Failure =
  | 'unavailable'
  | 'notAuthorised'
  | 'invalidCredential'
  | 'locked'
  | 'tooManyAttempts'
  | 'notFound';

export class VaultError extends Error {
  constructor(readonly failure: Failure) {
    super(failure);
    this.name = 'VaultError';
  }

  /** User-facing text. Never names infrastructure — see ARCHITECTURE §23. */
  get text(): string {
    switch (this.failure) {
      case 'notAuthorised':
        return 'This device is not authorised.';
      case 'invalidCredential':
        return 'Please check your details and try again.';
      case 'locked':
        return 'Enter the document master password to continue.';
      case 'tooManyAttempts':
        return 'Too many attempts. Please try again later.';
      case 'notFound':
        return 'Page not found.';
      default:
        return 'Unable to load this page.';
    }
  }
}

// ── Session state ───────────────────────────────────────────────────────────
//
// NOTHING about being signed in survives a page load. The access token, the
// refresh token and the document grant are all module variables, so closing
// the tab, quitting the browser, or simply reloading ends the session and the
// next visit asks for the account password again.
//
// This is deliberate and it costs convenience. Storing the refresh token in
// localStorage — which is what this did first — meant a phone that had once
// signed in stayed signed in essentially forever: reopening the tab, even
// after force-quitting the browser, walked straight back into the document
// list. For a vault of personal documents on a device that might be lent,
// stolen or simply picked up, that is the wrong trade.
//
// What DOES persist is the device identity: the device id here, and the
// non-extractable signing key in IndexedDB. Those are what save the person
// from needing a fresh setup code every time. They authorise the *device*;
// they never authorise a *session*.

let accessToken: string | null = null;
let refreshToken: string | null = null;
let grantToken: string | null = null;
let grantExpiresAt: Date | null = null;

/** Full sign-out after the page has been out of sight this long. Covers the
 *  tab left open in a pocket for hours, which a reload-based rule alone
 *  would not. */
const HIDDEN_SIGN_OUT_MS = 5 * 60 * 1000;
let hiddenSince: number | null = null;

const DEVICE_ID = 'vault.device.id';

export const session = {
  get deviceId() {
    return localStorage.getItem(DEVICE_ID);
  },
  get refreshToken() {
    return refreshToken;
  },
  get isEnrolled() {
    return localStorage.getItem(DEVICE_ID) !== null;
  },
  get isSignedIn() {
    return refreshToken !== null;
  },
  get isUnlocked() {
    return grantToken !== null && grantExpiresAt !== null && grantExpiresAt > new Date();
  },
  get unlockSecondsLeft() {
    if (!grantExpiresAt) return 0;
    return Math.max(0, Math.floor((grantExpiresAt.getTime() - Date.now()) / 1000));
  },
  lock() {
    grantToken = null;
    grantExpiresAt = null;
  },
  async signOutLocal() {
    accessToken = null;
    refreshToken = null;
    hiddenSince = null;
    this.lock();
  },
  async forgetEverything() {
    await this.signOutLocal();
    localStorage.removeItem(DEVICE_ID);
    await forgetDevice();
  },

  /** Called when the page goes out of sight. The unlock window closes at once;
   *  the session itself survives a brief app switch but not a long absence. */
  onHidden() {
    this.lock();
    hiddenSince = Date.now();
  },

  /** Returns false if the absence was long enough to end the session. */
  onVisible(): boolean {
    if (hiddenSince !== null && Date.now() - hiddenSince > HIDDEN_SIGN_OUT_MS) {
      void this.signOutLocal();
      return false;
    }
    hiddenSince = null;
    return this.isSignedIn;
  },
};

function nonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '');
}

function codeOf(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error?: { code?: string } }).error;
    return err?.code ?? null;
  }
  return null;
}

function failureFor(code: string | null): Failure {
  switch (code) {
    case 'GRANT_REQUIRED':
      return 'locked';
    case 'INVALID_CREDENTIAL':
      return 'invalidCredential';
    case 'UNAUTHORIZED':
      return 'notAuthorised';
    case 'TOO_MANY_REQUESTS':
      return 'tooManyAttempts';
    case 'NOT_FOUND':
      return 'notFound';
    default:
      return 'unavailable';
  }
}

interface SendOptions {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string>;
  withGrant?: boolean;
  asBytes?: boolean;
  overrideDeviceId?: string;
  allowRefresh?: boolean;
}

async function raw(opts: SendOptions): Promise<Response> {
  const query =
    opts.query && Object.keys(opts.query).length
      ? '?' +
        Object.entries(opts.query)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&')
      : '';
  const pathWithQuery = `${API}${opts.path}${query}`;

  // Serialised once. The signature covers these bytes and these bytes are what
  // get sent — re-encoding anywhere between would invalidate the signature.
  const rawBody = opts.body === undefined ? '' : JSON.stringify(opts.body);

  const timestamp = Date.now();
  const n = nonce();
  const signature = await sign(
    await canonicalRequest(opts.method, pathWithQuery, timestamp, n, rawBody),
  );

  const headers: Record<string, string> = {
    'x-device-id': opts.overrideDeviceId ?? session.deviceId ?? '',
    'x-timestamp': String(timestamp),
    'x-nonce': n,
    'x-signature': signature,
  };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken) headers['authorization'] = `Bearer ${accessToken}`;
  if (opts.withGrant && grantToken) headers['x-vault-grant'] = grantToken;

  try {
    return await fetch(pathWithQuery, {
      method: opts.method.toUpperCase(),
      headers,
      body: rawBody === '' ? undefined : rawBody,
    });
  } catch {
    // Offline, DNS failure, TLS failure, tunnel down — all the same thing.
    throw new VaultError('unavailable');
  }
}

async function send<T>(opts: SendOptions): Promise<T> {
  let response = await raw(opts);

  if (response.status === 401 && opts.allowRefresh !== false) {
    const body = await response.clone().json().catch(() => null);
    // Only a session problem is worth retrying. A rejected credential is not,
    // and re-sending it would burn a second attempt against the lockout.
    if (codeOf(body) === 'UNAUTHORIZED' && (await tryRefresh())) {
      response = await raw(opts);
    }
  }

  if (!response.ok) {
    const body = opts.asBytes ? null : await response.json().catch(() => null);
    throw new VaultError(failureFor(codeOf(body)));
  }

  if (opts.asBytes) return (await response.arrayBuffer()) as unknown as T;
  if (response.status === 204) return undefined as unknown as T;
  return (await response.json()) as T;
}

async function tryRefresh(): Promise<boolean> {
  const current = refreshToken;
  if (!current) return false;
  try {
    const response = await raw({
      method: 'post',
      path: '/auth/refresh',
      body: { refreshToken: current },
      allowRefresh: false,
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { accessToken: string; refreshToken: string };
    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
    return true;
  } catch {
    return false;
  }
}

// ── Wire types ──────────────────────────────────────────────────────────────

export interface DocumentMeta {
  id: string;
  title: string;
  filename: string;
  fileType: string;
  sizeBytes: number;
  category: { slug: string; name: string };
  tags: string[];
  isFavourite: boolean;
  documentDate: string | null;
  uploadedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
}

export interface CategorySummary {
  slug: string;
  name: string;
  documentCount: number;
}

// ── The complete set of things this site can ask for ────────────────────────
//
// Worth reading as a list: there is no call that changes, resets, recovers or
// reads the Document Master Password. Only the administrator console can do
// that, and this is not it.

export const vault = {
  async enroll(code: string, deviceName: string) {
    const result = await send<{ deviceId: string }>({
      method: 'post',
      path: '/auth/enroll',
      allowRefresh: false,
      // No device id exists yet; the signature proves possession of the key
      // being enrolled.
      overrideDeviceId: '00000000-0000-4000-8000-000000000000',
      body: {
        code,
        publicKey: await publicKeyB64(),
        deviceName,
        platform: 'linux',
      },
    });
    localStorage.setItem(DEVICE_ID, result.deviceId);
  },

  async signIn(loginId: string, password: string) {
    const data = await send<{ accessToken: string; refreshToken: string }>({
      method: 'post',
      path: '/auth/login',
      allowRefresh: false,
      body: { loginId, password },
    });
    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
  },

  async resume(): Promise<boolean> {
    if (!session.isSignedIn) return false;
    return tryRefresh();
  },

  async signOut() {
    try {
      await send({ method: 'post', path: '/auth/logout' });
    } catch {
      // Ending the local session matters more than the round trip.
    }
    await session.signOutLocal();
  },

  identity: () => send<{ displayName: string; deviceName: string }>({ method: 'get', path: '/auth/me' }),

  categories: () => send<CategorySummary[]>({ method: 'get', path: '/categories' }),

  documents: (opts: { q?: string; category?: string; favourites?: boolean } = {}) =>
    send<Page<DocumentMeta>>({
      method: 'get',
      path: '/documents',
      query: {
        ...(opts.q ? { q: opts.q } : {}),
        ...(opts.category ? { category: opts.category } : {}),
        ...(opts.favourites ? { favorites: 'true' } : {}),
      },
    }),

  setFavourite: (id: string, on: boolean) =>
    send<void>({ method: on ? 'post' : 'delete', path: `/documents/${id}/favorite` }),

  /** Submits the master password. The site keeps only the short-lived grant
   *  that comes back — never the password itself. */
  async unlock(password: string) {
    const data = await send<{ grant: string; expiresAt: string }>({
      method: 'post',
      path: '/vault/unlock',
      body: { password },
    });
    grantToken = data.grant;
    grantExpiresAt = new Date(data.expiresAt);
  },

  async lock() {
    session.lock();
    try {
      await send({ method: 'post', path: '/vault/lock' });
    } catch {
      // The local lock already happened; that is the part that matters.
    }
  },

  content: (id: string, preview = false) =>
    send<ArrayBuffer>({
      method: 'get',
      path: `/documents/${id}/${preview ? 'preview' : 'content'}`,
      withGrant: true,
      asBytes: true,
    }),
};
