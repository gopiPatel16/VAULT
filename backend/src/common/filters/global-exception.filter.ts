import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AppError } from '../errors/app-error';
import { PublicErrorCode, PublicErrorCodeValue } from '../errors/public-error-codes';
import type { VaultRequest } from '../request-context';
import * as crypto from 'node:crypto';

/**
 * The sanitiser. Every error the process produces leaves through here.
 *
 * Two audiences, strictly separated:
 *
 *   the caller  →  { error: { code, requestId } }   and nothing else, ever
 *   the server  →  the full exception, stack included, tagged with the same
 *                  requestId
 *
 * A dropped database connection, a missing storage path, a Prisma error naming
 * a table, an ENOENT carrying an absolute filesystem path — all of them become
 * an indistinguishable 404. The caller cannot tell a broken deployment from a
 * document that does not exist, which is the entire point of ARCHITECTURE §3.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Vault');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<VaultRequest>();
    // Unmatched routes never reach the context middleware, so a fresh id is
    // minted rather than emitting a constant an attacker could fingerprint.
    const requestId =
      req?.vault?.requestId ?? crypto.randomBytes(12).toString('base64url');

    const { status, code, internal, security } = this.classify(exception);

    const logLine =
      `[${requestId}] ${req?.method ?? '?'} ${this.safePath(req)} ` +
      `→ ${status} ${code} :: ${internal}`;

    if (status >= 500) {
      this.logger.error(logLine, (exception as Error)?.stack);
    } else if (security) {
      this.logger.warn(logLine);
    } else {
      this.logger.debug(logLine);
    }

    if (exception instanceof AppError && exception.internalContext) {
      this.logger.debug(
        `[${requestId}] context ${JSON.stringify(exception.internalContext)}`,
      );
    }

    // A failure that happens mid-stream cannot be turned into a JSON body — the
    // response is already committed. Destroy it instead: the client sees a
    // truncated transfer, which its generic-failure path already handles.
    if (reply.sent || reply.raw.headersSent) {
      this.logger.warn(`[${requestId}] error after headers sent; destroying response`);
      reply.raw.destroy();
      return;
    }

    void reply
      .status(status)
      .header('Cache-Control', 'no-store')
      .send({ error: { code, requestId } });
  }

  private classify(exception: unknown): {
    status: number;
    code: PublicErrorCodeValue;
    internal: string;
    security: boolean;
  } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.publicCode,
        internal: exception.internalReason,
        security: exception.securityRelevant,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // Nest/Fastify built-ins (404 route miss, 413, 415, validation) carry
      // messages that can name framework internals. The status is kept; the
      // message is dropped on the floor.
      const code =
        status === 404
          ? PublicErrorCode.NOT_FOUND
          : status === 401
            ? PublicErrorCode.UNAUTHORIZED
            : status === 403
              ? PublicErrorCode.NOT_FOUND // never confirm existence
              : status === 413
                ? PublicErrorCode.PAYLOAD_TOO_LARGE
                : status === 415
                  ? PublicErrorCode.UNSUPPORTED_MEDIA_TYPE
                  : status === 429
                    ? PublicErrorCode.TOO_MANY_REQUESTS
                    : status < 500
                      ? PublicErrorCode.INVALID_REQUEST
                      : PublicErrorCode.UNAVAILABLE;
      return {
        status: status === 403 ? 404 : status,
        code,
        internal: `HttpException: ${exception.message}`,
        security: status === 401 || status === 403,
      };
    }

    // Everything else — Prisma errors, ENOENT, ECONNREFUSED, TypeErrors.
    // Nothing about them reaches the caller.
    const err = exception as { code?: string; message?: string; name?: string };
    return {
      status: 500,
      code: PublicErrorCode.UNAVAILABLE,
      internal: `Unhandled ${err?.name ?? 'error'}${err?.code ? ` (${err.code})` : ''}: ${err?.message ?? String(exception)}`,
      security: false,
    };
  }

  /** Log the path without the query string: search terms are document data. */
  private safePath(req: VaultRequest | undefined): string {
    if (!req?.url) return '?';
    const q = req.url.indexOf('?');
    return q === -1 ? req.url : `${req.url.slice(0, q)}?<redacted>`;
  }
}
