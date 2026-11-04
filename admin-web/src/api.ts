/**
 * The administrator API client.
 *
 * The session token is held in a module variable and nowhere else — not
 * localStorage, not sessionStorage, not a cookie. Three consequences, all
 * intended:
 *
 *   * XSS in this console cannot lift a token out of storage
 *   * there is no cookie, so CSRF does not apply to the admin surface at all
 *   * a page refresh signs you out
 *
 * The third is a real cost, and it is the right trade for the one console that
 * can change the Document Master Password.
 */

const BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:3100';
const API = `${BASE}/api/v1`;

let token: string | null = null;

export function setToken(value: string | null): void {
  token = value;
}

export function hasToken(): boolean {
  return token !== null;
}

/** Everything the API can tell the console went wrong. */
export type ApiErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIAL'
  | 'INVALID_REQUEST'
  | 'TOO_MANY_REQUESTS'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PRECONDITION_FAILED'
  | 'UNAVAILABLE';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
  ) {
    super(code);
    this.name = 'ApiError';
  }

  /** The backend asks for a fresh step-up before destructive operations. */
  get needsStepUp(): boolean {
    return this.status === 412;
  }

  get message_(): string {
    switch (this.code) {
      case 'INVALID_CREDENTIAL':
        return 'Those credentials were not accepted.';
      case 'UNAUTHORIZED':
        return 'Not authorised. Sign in again.';
      case 'TOO_MANY_REQUESTS':
        return 'Too many attempts. Try again later.';
      case 'CONFLICT':
        return 'That conflicts with something that already exists.';
      case 'PAYLOAD_TOO_LARGE':
        return 'That file is too large.';
      case 'UNSUPPORTED_MEDIA_TYPE':
        return 'That file type is not accepted.';
      case 'INVALID_REQUEST':
        return 'Check the values and try again.';
      case 'PRECONDITION_FAILED':
        return 'Re-authentication required.';
      case 'NOT_FOUND':
        return 'Not found.';
      default:
        return 'Unable to complete that request.';
    }
  }
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function codeOf(body: unknown): ApiErrorCode {
  if (
    body &&
    typeof body === 'object' &&
    'error' in body &&
    body.error &&
    typeof body.error === 'object' &&
    'code' in body.error
  ) {
    return (body.error as { code: ApiErrorCode }).code;
  }
  return 'UNAVAILABLE';
}

async function request<T>(
  method: string,
  route: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${route}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Same collapsing rule as the client: a transport failure is not a
    // diagnostic the operator needs, and this console is reachable only from a
    // private network anyway.
    throw new ApiError('UNAVAILABLE', 0);
  }

  const payload = await parse(response);
  if (!response.ok) {
    throw new ApiError(codeOf(payload), response.status);
  }
  return payload as T;
}

export const api = {
  get: <T>(route: string) => request<T>('GET', route),
  post: <T>(route: string, body?: unknown) => request<T>('POST', route, body),
  put: <T>(route: string, body?: unknown) => request<T>('PUT', route, body),
  patch: <T>(route: string, body?: unknown) => request<T>('PATCH', route, body),
  del: <T>(route: string) => request<T>('DELETE', route),

  async upload(form: FormData): Promise<DocumentMeta> {
    let response: Response;
    try {
      response = await fetch(`${API}/admin/documents/upload`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: form,
      });
    } catch {
      throw new ApiError('UNAVAILABLE', 0);
    }
    const payload = await parse(response);
    if (!response.ok) throw new ApiError(codeOf(payload), response.status);
    return payload as DocumentMeta;
  },
};

// ── Wire types ──────────────────────────────────────────────────────────────

export interface Dashboard {
  documents: number;
  activeClients: number;
  activeDevices: number;
  storage: { bytes: number; objects: number };
  activeDocumentSessions: number;
  failedEventsLast24h: number;
  masterPassword: { configured: boolean; version: number; grantTtlSeconds: number };
  recentEvents: { at: string; event: string; result: string; actorType: string }[];
}

export interface DocumentMeta {
  id: string;
  title: string;
  filename: string;
  fileType: string;
  sizeBytes: number;
  category: { slug: string; name: string };
  tags: string[];
  documentDate: string | null;
  uploadedAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ClientSummary {
  id: string;
  displayName: string;
  loginId: string;
  status: string;
  maxDevices: number;
  deviceCount: number;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface DeviceSummary {
  id: string;
  name: string;
  platform: string;
  status: string;
  enrolledAt: string;
  lastSeenAt: string | null;
}

export interface Category {
  slug: string;
  name: string;
}

export interface MasterPasswordStatus {
  configured: boolean;
  version: number;
  grantTtlSeconds: number;
  allowedGrantTtls: number[];
  activeDocumentSessions: number;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorType: string;
  actorId: string | null;
  deviceId: string | null;
  event: string;
  targetType: string | null;
  targetId: string | null;
  result: string;
  metadata: Record<string, unknown>;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
