/**
 * The complete set of strings a client may ever see in an error response.
 *
 * Adding a value here is a security decision: every code is a channel through
 * which the backend tells an untrusted caller something about its own state.
 * Keep the list short and keep every entry meaningless to an attacker.
 */
export const PublicErrorCode = {
  /** Covers: does not exist, exists but not permitted, storage failure,
   *  database failure. Deliberately indistinguishable — see docs/ARCHITECTURE §14. */
  NOT_FOUND: 'NOT_FOUND',

  /** Layer-1 failure: no/invalid/expired token, revoked device or client. */
  UNAUTHORIZED: 'UNAUTHORIZED',

  /** Layer-2 missing or expired. The one code that says something real: the
   *  caller must enter the Document Master Password. The user already knows
   *  this, so it leaks nothing. */
  GRANT_REQUIRED: 'GRANT_REQUIRED',

  /** A supplied credential was wrong. Never says WHICH part was wrong. */
  INVALID_CREDENTIAL: 'INVALID_CREDENTIAL',

  /** Malformed request from the caller's own schema. */
  INVALID_REQUEST: 'INVALID_REQUEST',

  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',

  /** Anything unhandled. Never accompanied by a reason. */
  UNAVAILABLE: 'UNAVAILABLE',

  // ── admin-surface only, on a private network ──
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
} as const;

export type PublicErrorCodeValue =
  (typeof PublicErrorCode)[keyof typeof PublicErrorCode];
