import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRES_GRANT_KEY } from '../decorators/route.decorators';
import { GrantService } from '../../modules/vault/grant.service';
import { AppError } from '../errors/app-error';
import type { VaultRequest } from '../request-context';

/**
 * Layer 2 — the Document Master Password authorisation.
 *
 * Being logged in is never sufficient to read document bytes. This guard is
 * what stops the §17 bypass: calling `GET /documents/{id}/content` directly
 * with a perfectly valid session gets nothing.
 *
 * Note the ordering: the grant is checked BEFORE any document is looked up.
 * That is deliberate — a caller without a valid grant receives exactly the
 * same response for a document that exists and one that does not, so this
 * endpoint cannot be used to enumerate the vault.
 */
@Injectable()
export class DocumentGrantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly grants: GrantService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRES_GRANT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const req = context.switchToHttp().getRequest<VaultRequest>();
    const header = req.headers['x-vault-grant'];
    const token = Array.isArray(header) ? header[0] : header;

    if (!token) {
      throw AppError.grantRequired('no document grant presented');
    }

    const grant = await this.grants.validate(token, {
      clientId: req.vault.client!.id,
      deviceId: req.vault.device!.id,
      sessionId: req.vault.session!.id,
    });

    if (!grant.ok) {
      throw AppError.grantRequired(`document grant rejected: ${grant.reason}`, {
        clientId: req.vault.client!.id,
        deviceId: req.vault.device!.id,
      });
    }

    req.vault.grant = { id: grant.id, expiresAt: grant.expiresAt };
    return true;
  }
}
