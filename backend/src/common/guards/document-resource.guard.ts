import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DOCUMENT_RESOURCE_KEY } from '../decorators/route.decorators';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { AuditService, AuditEvent } from '../../modules/audit/audit.service';
import { documentAccessFilter } from '../../modules/documents/document-access';
import { AppError } from '../errors/app-error';
import type { VaultRequest } from '../request-context';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * IDOR protection, made structural rather than conventional.
 *
 * The document is resolved here through an access-scoped query and attached to
 * the request. Handlers receive the row via `@CurrentDocument()` and have no
 * other way to obtain one — so a handler physically cannot operate on a
 * document the caller was not authorised for, even if its author forgot to
 * check. Changing `/documents/<a>` to `/documents/<b>` simply fails to resolve.
 *
 * Random UUID ids make enumeration impractical, but that is defence in depth.
 * This query is the actual control.
 */
@Injectable()
export class DocumentResourceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      DOCUMENT_RESOURCE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const req = context.switchToHttp().getRequest<VaultRequest>();
    const id = req.params?.id ?? '';
    const clientId = req.vault.client!.id;

    // A malformed id is a miss, not a database error. Postgres would otherwise
    // raise an invalid-uuid error, and an error shape that differs from a plain
    // 404 is itself a signal.
    if (!UUID_RE.test(id)) {
      throw AppError.notFound('malformed document id', { id: id.slice(0, 64) });
    }

    const document = await this.prisma.document.findFirst({
      where: { id, ...documentAccessFilter(clientId) },
    });

    if (!document) {
      // Distinguish the two cases for the AUDIT LOG only. The caller sees the
      // same 404 either way; the administrator needs to know the difference,
      // because "authenticated client probing for documents it cannot have" is
      // exactly the signal worth alerting on.
      const exists = await this.prisma.document.count({
        where: { id, deletedAt: null },
      });
      if (exists > 0) {
        await this.audit.record({
          actorType: 'client',
          actorId: clientId,
          deviceId: req.vault.device?.id ?? null,
          event: AuditEvent.DOCUMENT_ACCESS_DENIED,
          targetType: 'document',
          targetId: id,
          result: 'failure',
          ipHash: req.vault.ipHash,
        });
      }
      throw AppError.notFound('document not found or not permitted', {
        id,
        clientId,
        existedButDenied: exists > 0,
      });
    }

    req.vault.document = document;
    return true;
  }
}
