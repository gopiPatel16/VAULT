import { Injectable, Inject } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../../common/crypto/password.service';
import { AccessTokenService } from './access-token.service';
import { AuditService, AuditEvent } from '../audit/audit.service';
import { hashOpaqueToken, issueOpaqueToken } from '../../common/crypto/tokens';
import { AppError } from '../../common/errors/app-error';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import type { VaultRequestContext } from '../../common/request-context';
import { EnrollDto, LoginDto, RefreshDto } from './dto/auth.dto';
import { toDbBytes } from '../../common/crypto/bytes';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: AccessTokenService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Register a device against a one-time administrator-issued code.
   *
   * Enrolment alone confers nothing: it records the device's public key and
   * stops. The client must still authenticate with the account password to
   * obtain a session, so a leaked enrolment code by itself is not a way in.
   */
  async enroll(dto: EnrollDto, ctx: VaultRequestContext): Promise<{ deviceId: string }> {
    const record = await this.prisma.enrollmentCode.findUnique({
      where: { codeHash: toDbBytes(hashOpaqueToken(dto.code)) },
      include: { client: { include: { _count: { select: { devices: true } } } } },
    });

    const invalid =
      !record ||
      record.usedAt !== null ||
      record.expiresAt <= new Date() ||
      record.client.status !== 'active';

    if (invalid) {
      await this.audit.record({
        actorType: 'system',
        event: AuditEvent.CLIENT_ENROLLED,
        result: 'failure',
        ipHash: ctx.ipHash,
        metadata: { reason: 'code rejected' },
      });
      throw AppError.invalidCredential('enrolment code rejected', {
        found: Boolean(record),
        used: record?.usedAt !== null,
      });
    }

    // A leaked code should not be able to spawn an unlimited fleet.
    if (record.client._count.devices >= record.client.maxDevices) {
      throw AppError.invalidCredential('device limit reached for client', {
        clientId: record.clientId,
      });
    }

    const device = await this.prisma.$transaction(async (tx) => {
      // Mark the code used inside the same transaction as the device insert,
      // so two concurrent redemptions cannot both succeed.
      const claimed = await tx.enrollmentCode.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw AppError.invalidCredential('enrolment code already redeemed', {
          codeId: record.id,
        });
      }
      return tx.device.create({
        data: {
          clientId: record.clientId,
          name: dto.deviceName,
          platform: dto.platform,
          publicKey: toDbBytes(Buffer.from(dto.publicKey, 'base64')),
        },
      });
    });

    await this.audit.record({
      actorType: 'client',
      actorId: record.clientId,
      deviceId: device.id,
      event: AuditEvent.CLIENT_ENROLLED,
      targetType: 'device',
      targetId: device.id,
      result: 'success',
      ipHash: ctx.ipHash,
      metadata: { platform: dto.platform },
    });

    return { deviceId: device.id };
  }

  async login(
    dto: LoginDto,
    ctx: VaultRequestContext,
  ): Promise<{ accessToken: string; expiresIn: number; refreshToken: string }> {
    // DeviceStatusGuard has already confirmed the signing device is active and
    // resolved its owning client.
    const deviceId = ctx.device!.id;
    const clientId = ctx.client!.id;

    const client = await this.prisma.client.findUnique({ where: { id: clientId } });

    // The account is reached through the device, so a wrong loginId is just a
    // wrong credential — it never reveals whether that login exists.
    const ok =
      client !== null &&
      client.loginId.toLowerCase() === dto.loginId.trim().toLowerCase() &&
      (await this.passwords.verify(client.passwordHash, dto.password));

    if (!ok) {
      if (!client) await this.passwords.burnTime();
      await this.audit.record({
        actorType: 'client',
        actorId: clientId,
        deviceId,
        event: AuditEvent.CLIENT_LOGIN_FAILURE,
        result: 'failure',
        ipHash: ctx.ipHash,
      });
      throw AppError.invalidCredential('client login failed', { clientId, deviceId });
    }

    const session = await this.createSession(clientId, deviceId, crypto.randomUUID());

    await this.audit.record({
      actorType: 'client',
      actorId: clientId,
      deviceId,
      event: AuditEvent.CLIENT_LOGIN_SUCCESS,
      result: 'success',
      ipHash: ctx.ipHash,
    });

    return session;
  }

  /**
   * Rotating refresh with reuse detection.
   *
   * Rotated-out sessions are kept (revoked, not deleted) precisely so that
   * presenting one is recognisable. A replayed refresh token means the token
   * was copied, so the entire family is destroyed rather than just the one
   * session — the legitimate device is logged out too, which is the correct
   * outcome when there is evidence of theft.
   */
  async refresh(
    dto: RefreshDto,
    ctx: VaultRequestContext,
  ): Promise<{ accessToken: string; expiresIn: number; refreshToken: string }> {
    const deviceId = ctx.device!.id;
    const existing = await this.prisma.session.findUnique({
      where: { refreshTokenHash: toDbBytes(hashOpaqueToken(dto.refreshToken)) },
    });

    if (!existing || existing.deviceId !== deviceId) {
      throw AppError.unauthorized('refresh token not recognised', { deviceId });
    }

    if (existing.revokedAt !== null || existing.expiresAt <= new Date()) {
      // Burn the family once per incident. Every token in it is revoked from
      // here on, so without this check the legitimate device's next attempt —
      // and every retry after it — would raise another "theft detected" alert
      // for the same event and bury the real one.
      if (existing.revokedAt !== null && existing.reuseDetectedAt === null) {
        await this.prisma.$transaction([
          this.prisma.session.updateMany({
            where: { familyId: existing.familyId, revokedAt: null },
            data: { revokedAt: new Date(), reuseDetectedAt: new Date() },
          }),
          this.prisma.documentGrant.updateMany({
            where: { session: { familyId: existing.familyId }, revokedAt: null },
            data: { revokedAt: new Date() },
          }),
        ]);
        await this.audit.record({
          actorType: 'client',
          actorId: existing.clientId,
          deviceId,
          event: AuditEvent.CLIENT_REFRESH_REUSE,
          result: 'failure',
          ipHash: ctx.ipHash,
          metadata: { familyId: existing.familyId },
        });
      }
      throw AppError.unauthorized('refresh token revoked or expired', { deviceId });
    }

    const rotated = await this.createSession(
      existing.clientId,
      deviceId,
      existing.familyId,
      existing.id,
    );
    return rotated;
  }

  async logout(ctx: VaultRequestContext): Promise<void> {
    const sessionId = ctx.session!.id;
    await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      // Signing out drops Layer 2 as well. Leaving a live grant behind after an
      // explicit logout would be a small but real hole.
      this.prisma.documentGrant.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      actorType: 'client',
      actorId: ctx.client!.id,
      deviceId: ctx.device!.id,
      event: AuditEvent.CLIENT_LOGOUT,
      result: 'success',
      ipHash: ctx.ipHash,
    });
  }

  private async createSession(
    clientId: string,
    deviceId: string,
    familyId: string,
    rotatesSessionId?: string,
  ): Promise<{ accessToken: string; expiresIn: number; refreshToken: string }> {
    const refresh = issueOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );

    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          clientId,
          deviceId,
          familyId,
          refreshTokenHash: toDbBytes(refresh.hash),
          expiresAt,
        },
      });

      if (rotatesSessionId) {
        await tx.session.update({
          where: { id: rotatesSessionId },
          data: { revokedAt: new Date() },
        });
        // Carry any live document grant across the rotation. Without this a
        // token refresh mid-read would silently re-lock the document even
        // though the master password window has not elapsed.
        await tx.documentGrant.updateMany({
          where: { sessionId: rotatesSessionId, revokedAt: null },
          data: { sessionId: created.id },
        });
      }
      return created;
    });

    const access = this.tokens.issueClientAccessToken({
      clientId,
      deviceId,
      sessionId: session.id,
    });

    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: refresh.value,
    };
  }
}
