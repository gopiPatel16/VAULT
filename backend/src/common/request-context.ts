import type { Document } from '@prisma/client';

/**
 * Route scopes. Every route MUST declare one — `RouteScopeGuard` rejects any
 * route that does not, so a newly added endpoint fails closed.
 */
export type RouteScope =
  /** No authentication at all. */
  | 'public'
  /** Signature verified against the public key IN THE REQUEST BODY. Used only
   *  by device enrolment, as proof of possession of the key being enrolled. */
  | 'enrollment'
  /** Device signature verified against the STORED key, but no bearer token
   *  yet. Used by login and refresh. */
  | 'device'
  /** Layer 1: bearer access token + device signature. */
  | 'client'
  /** Administrator surface. Separate token audience; never satisfied by a
   *  client token, and never satisfies a client route. */
  | 'admin';

export interface VaultRequestContext {
  requestId: string;
  /** Set by RouteScopeGuard, which is the first guard to run and which rejects
   *  any route that failed to declare one. Undefined here means no guard after
   *  it ever executed. */
  scope?: RouteScope;
  /** Salted hash of the peer address. The raw IP is never persisted. */
  ipHash: string;

  /** Set once the device signature has been verified. */
  signedDeviceId?: string;

  // ── Layer 1 ──
  client?: { id: string; displayName: string };
  device?: { id: string; name: string };
  session?: { id: string };
  tokenJti?: string;

  // ── Layer 2 ──
  grant?: { id: string; expiresAt: Date };

  /** Populated by DocumentResourceGuard *only* after an authorisation-scoped
   *  lookup. Handlers have no other route to a Document row, which is what
   *  makes the IDOR protection structural rather than conventional. */
  document?: Document;

  // ── Administrator ──
  admin?: { id: string; username: string };
  adminSession?: { id: string; stepUpAt: Date | null };
}

export interface VaultRequest {
  vault: VaultRequestContext;
  rawBody?: Buffer;
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  ip: string;
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
}
