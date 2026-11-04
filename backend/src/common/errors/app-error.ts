import { PublicErrorCode, PublicErrorCodeValue } from './public-error-codes';

/**
 * The only error type handlers should throw.
 *
 * It carries two separate payloads that must never be confused:
 *   `publicCode` / `status` → sent to the caller.
 *   `internalReason`        → written to the protected server log only.
 */
export class AppError extends Error {
  constructor(
    readonly publicCode: PublicErrorCodeValue,
    readonly status: number,
    /** Never leaves the process except into the server-side log. */
    readonly internalReason: string,
    /** Server-log-only structured context. Must not contain secrets. */
    readonly internalContext?: Record<string, unknown>,
    /** Raise the log level and mirror into the audit trail. */
    readonly securityRelevant = false,
  ) {
    super(internalReason);
    this.name = 'AppError';
  }

  // ── Layer-1 ───────────────────────────────────────────────────────────────

  static unauthorized(reason: string, ctx?: Record<string, unknown>) {
    return new AppError(PublicErrorCode.UNAUTHORIZED, 401, reason, ctx, true);
  }

  static invalidCredential(reason: string, ctx?: Record<string, unknown>) {
    return new AppError(
      PublicErrorCode.INVALID_CREDENTIAL,
      401,
      reason,
      ctx,
      true,
    );
  }

  // ── Layer-2 ───────────────────────────────────────────────────────────────

  static grantRequired(reason: string, ctx?: Record<string, unknown>) {
    return new AppError(PublicErrorCode.GRANT_REQUIRED, 401, reason, ctx);
  }

  // ── Resources ─────────────────────────────────────────────────────────────

  /**
   * The single most important helper in the codebase.
   *
   * "Not found", "you may not have this", and "the storage layer is broken"
   * all funnel through here so that a caller cannot tell them apart. Returning
   * 403 for the second case would be an existence oracle (ARCHITECTURE §17/§18).
   */
  static notFound(reason: string, ctx?: Record<string, unknown>, security = false) {
    return new AppError(PublicErrorCode.NOT_FOUND, 404, reason, ctx, security);
  }

  static invalidRequest(reason: string, ctx?: Record<string, unknown>) {
    return new AppError(PublicErrorCode.INVALID_REQUEST, 400, reason, ctx);
  }

  static tooManyRequests(reason: string, ctx?: Record<string, unknown>) {
    return new AppError(
      PublicErrorCode.TOO_MANY_REQUESTS,
      429,
      reason,
      ctx,
      true,
    );
  }

  static unavailable(reason: string, ctx?: Record<string, unknown>) {
    return new AppError(PublicErrorCode.UNAVAILABLE, 500, reason, ctx);
  }

  // ── admin surface ─────────────────────────────────────────────────────────

  static conflict(reason: string, ctx?: Record<string, unknown>) {
    return new AppError(PublicErrorCode.CONFLICT, 409, reason, ctx);
  }

  static payloadTooLarge(reason: string, ctx?: Record<string, unknown>) {
    return new AppError(PublicErrorCode.PAYLOAD_TOO_LARGE, 413, reason, ctx);
  }

  static unsupportedMediaType(reason: string, ctx?: Record<string, unknown>) {
    return new AppError(
      PublicErrorCode.UNSUPPORTED_MEDIA_TYPE,
      415,
      reason,
      ctx,
    );
  }

  static preconditionFailed(reason: string, ctx?: Record<string, unknown>) {
    return new AppError(PublicErrorCode.PRECONDITION_FAILED, 412, reason, ctx);
  }
}
