import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { hashOpaqueToken } from '../crypto/tokens';
import { REQUIRES_STEPUP_KEY } from '../decorators/route.decorators';
import { AppError } from '../errors/app-error';
import type { VaultRequest } from '../request-context';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import { Inject } from '@nestjs/common';
import { toDbBytes } from '../crypto/bytes';

/**
 * The administrator surface.
 *
 * Administrator sessions are opaque server-side tokens, not JWTs. That is a
 * second, structural reason a client token can never act as an admin token and
 * vice versa: a client access token is a signed JWT that will never be found in
 * `admin_sessions`, and an admin token is random bytes that will never verify
 * as a JWT. The separation does not depend on anyone remembering to check an
 * audience claim.
 *
 * Admin tokens are held in memory by the admin SPA and sent as a bearer header
 * rather than a cookie, which removes CSRF from the admin surface entirely at
 * the cost of re-logging-in after a page refresh. On a private-network admin
 * console that is the right trade.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<VaultRequest>();
    if (req.vault.scope !== 'admin') return true;

    const header = req.headers['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw?.startsWith('Bearer ')) {
      throw AppError.unauthorized('missing admin bearer token');
    }

    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: toDbBytes(hashOpaqueToken(raw.slice(7).trim())) },
      include: { admin: true },
    });

    if (!session || session.revokedAt !== null || session.expiresAt <= new Date()) {
      throw AppError.unauthorized('admin session invalid or expired');
    }

    req.vault.admin = { id: session.admin.id, username: session.admin.username };
    req.vault.adminSession = { id: session.id, stepUpAt: session.stepUpAt };

    const needsStepUp = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRES_STEPUP_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (needsStepUp) {
      const cutoff = new Date(Date.now() - this.config.adminStepUpTtlSeconds * 1000);
      if (!session.stepUpAt || session.stepUpAt < cutoff) {
        // Distinct from a plain 401 so the admin console knows to prompt for
        // re-authentication rather than bouncing to the login screen. This is
        // the administrator's own private surface, so the extra detail costs
        // nothing.
        throw AppError.preconditionFailed('step-up re-authentication required', {
          adminId: session.admin.id,
        });
      }
    }

    return true;
  }
}
