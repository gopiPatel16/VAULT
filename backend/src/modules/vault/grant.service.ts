import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashOpaqueToken, issueOpaqueToken } from '../../common/crypto/tokens';
import { toDbBytes } from '../../common/crypto/bytes';

export type GrantValidation =
  | { ok: true; id: string; expiresAt: Date }
  | { ok: false; reason: string };

/**
 * Document grants — the Layer-2 authorisations issued by a correct Document
 * Master Password.
 *
 * Opaque and server-side by design. A self-contained token (a JWT) would have
 * to be checked against a revocation list to support §12's "invalidate every
 * document session everywhere", and once a lookup is unavoidable the token may
 * as well be a random string with no readable contents at all.
 *
 * A grant is bound to client + device + session + master-password version.
 * Lifting one from a device buys nothing; it will not validate anywhere else.
 */
@Injectable()
export class GrantService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(params: {
    clientId: string;
    deviceId: string;
    sessionId: string;
    dmpVersion: number;
    ttlSeconds: number;
  }): Promise<{ token: string; expiresAt: Date }> {
    const token = issueOpaqueToken();
    const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);

    await this.prisma.$transaction([
      // One live grant per session. Re-entering the password replaces the old
      // window rather than accumulating overlapping ones.
      this.prisma.documentGrant.updateMany({
        where: { sessionId: params.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.documentGrant.create({
        data: {
          tokenHash: toDbBytes(token.hash),
          clientId: params.clientId,
          deviceId: params.deviceId,
          sessionId: params.sessionId,
          dmpVersion: params.dmpVersion,
          expiresAt,
        },
      }),
    ]);

    return { token: token.value, expiresAt };
  }

  async validate(
    token: string,
    binding: { clientId: string; deviceId: string; sessionId: string },
  ): Promise<GrantValidation> {
    const grant = await this.prisma.documentGrant.findUnique({
      where: { tokenHash: toDbBytes(hashOpaqueToken(token)) },
    });

    if (!grant) return { ok: false, reason: 'unknown grant' };
    if (grant.revokedAt !== null) return { ok: false, reason: 'grant revoked' };

    // Absolute expiry. There is no sliding renewal anywhere in this service:
    // renewing on activity would let a single unlock last all day and defeat
    // the point of a short-lived authorisation (ARCHITECTURE §15).
    if (grant.expiresAt <= new Date()) return { ok: false, reason: 'grant expired' };

    if (
      grant.clientId !== binding.clientId ||
      grant.deviceId !== binding.deviceId ||
      grant.sessionId !== binding.sessionId
    ) {
      return { ok: false, reason: 'grant bound to a different client/device/session' };
    }

    // The master-password generation check. Independent of revocation, so a
    // password change locks every client out even if the revocation sweep in
    // the same transaction had failed.
    const secret = await this.prisma.vaultSecret.findUnique({
      where: { id: 1 },
      select: { dmpVersion: true },
    });
    if (!secret || grant.dmpVersion !== secret.dmpVersion) {
      return { ok: false, reason: 'grant issued under a superseded master password' };
    }

    return { ok: true, id: grant.id, expiresAt: grant.expiresAt };
  }

  async revokeBySession(sessionId: string): Promise<void> {
    await this.prisma.documentGrant.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** §12 / §27: invalidate every document session across every client. */
  async revokeAll(): Promise<number> {
    const result = await this.prisma.documentGrant.updateMany({
      where: { revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async revokeForClient(clientId: string): Promise<number> {
    const result = await this.prisma.documentGrant.updateMany({
      where: { clientId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async revokeForDevice(deviceId: string): Promise<number> {
    const result = await this.prisma.documentGrant.updateMany({
      where: { deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /** Housekeeping: expired grants are already invalid, this just reclaims rows. */
  async purgeExpired(olderThanHours = 24): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    const result = await this.prisma.documentGrant.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return result.count;
  }

  async countActive(): Promise<number> {
    return this.prisma.documentGrant.count({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
    });
  }
}
