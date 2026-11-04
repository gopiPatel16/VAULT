import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { AuditService, AuditEvent } from '../../modules/audit/audit.service';
import { AppError } from '../errors/app-error';
import type { VaultRequest } from '../request-context';

/**
 * Layer 1, part two: is this device, client and session still live *right now*?
 *
 * This is what makes revocation immediate. An access token stays
 * cryptographically valid until it expires; this guard is the reason a revoked
 * device stops working on its very next request rather than up to ten minutes
 * later.
 */
@Injectable()
export class DeviceStatusGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<VaultRequest>();
    const scope = req.vault.scope;

    if (scope === 'device') {
      const device = await this.prisma.device.findUnique({
        where: { id: req.vault.signedDeviceId! },
        include: { client: true },
      });
      if (!device || device.status !== 'active' || device.client.status !== 'active') {
        await this.reject(req, device?.id, device?.clientId);
      }
      req.vault.device = { id: device!.id, name: device!.name };
      req.vault.client = { id: device!.client.id, displayName: device!.client.displayName };
      return true;
    }

    if (scope !== 'client') return true;

    const session = await this.prisma.session.findUnique({
      where: { id: req.vault.session!.id },
      include: { device: true, client: true },
    });

    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date() ||
      session.deviceId !== req.vault.signedDeviceId ||
      session.device.status !== 'active' ||
      session.client.status !== 'active'
    ) {
      await this.reject(req, session?.deviceId, session?.clientId);
    }

    req.vault.device = { id: session!.device.id, name: session!.device.name };
    req.vault.client = {
      id: session!.client.id,
      displayName: session!.client.displayName,
    };

    // Best-effort liveness for the admin's device list. Never awaited on the
    // request path, and a failure here must not affect the response.
    void this.prisma.device
      .update({ where: { id: session!.device.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);

    return true;
  }

  private async reject(
    req: VaultRequest,
    deviceId?: string,
    clientId?: string,
  ): Promise<never> {
    await this.audit.record({
      actorType: 'client',
      actorId: clientId ?? null,
      deviceId: deviceId ?? null,
      event: AuditEvent.DEVICE_REJECTED,
      result: 'failure',
      ipHash: req.vault.ipHash,
      metadata: { scope: req.vault.scope },
    });
    // The client is told only that it is not authorised. Nothing distinguishes
    // "your device was revoked" from "your session expired" from "your account
    // was suspended" — ARCHITECTURE §28.
    throw AppError.unauthorized('device, client or session not active', {
      deviceId,
      clientId,
    });
  }
}
