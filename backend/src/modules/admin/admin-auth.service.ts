import { Injectable, Inject } from '@nestjs/common';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../../common/crypto/password.service';
import { EnvelopeCryptoService } from '../../common/crypto/envelope.service';
import { AuditService, AuditEvent } from '../audit/audit.service';
import { hashOpaqueToken, issueOpaqueToken } from '../../common/crypto/tokens';
import { AppError } from '../../common/errors/app-error';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import type { VaultRequestContext } from '../../common/request-context';
import { fromDbBytes, toDbBytes } from '../../common/crypto/bytes';

export const TOTP_AAD = 'vault:admin-totp:v1';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/**
 * Administrator authentication.
 *
 * TOTP is mandatory, not optional. The administrator is the only role that can
 * change the Document Master Password, so a single stolen password must not be
 * enough to reach that button.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly envelope: EnvelopeCryptoService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private verifyTotp(sealedSecret: Uint8Array, code: string): boolean {
    let secret: string;
    try {
      secret = this.envelope.decryptSecret(fromDbBytes(sealedSecret), TOTP_AAD).toString('utf8');
    } catch {
      return false;
    }
    // One step of tolerance either side: enough for ordinary clock drift,
    // short enough that a shoulder-surfed code goes stale quickly.
    authenticator.options = { window: 1 };
    try {
      return authenticator.check(code, secret);
    } catch {
      return false;
    }
  }

  async login(
    username: string,
    password: string,
    totp: string,
    ctx: VaultRequestContext,
  ): Promise<{ token: string; expiresAt: Date }> {
    const admin = await this.prisma.admin.findUnique({
      where: { username: username.trim().toLowerCase() },
    });

    if (admin?.lockedUntil && admin.lockedUntil > new Date()) {
      throw AppError.invalidCredential('admin account locked', { adminId: admin.id });
    }

    const passwordOk = admin
      ? await this.passwords.verify(admin.passwordHash, password)
      : ((await this.passwords.burnTime()), false);

    const totpOk = admin ? this.verifyTotp(admin.totpSecretEnc, totp) : false;

    if (!admin || !passwordOk || !totpOk) {
      if (admin) {
        const failures = admin.failedAttempts + 1;
        await this.prisma.admin.update({
          where: { id: admin.id },
          data: {
            failedAttempts: failures,
            lockedUntil:
              failures >= MAX_FAILED_ATTEMPTS
                ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
                : null,
          },
        });
      }
      await this.audit.record({
        actorType: 'admin',
        actorId: admin?.id ?? null,
        event: AuditEvent.ADMIN_LOGIN_FAILURE,
        result: 'failure',
        ipHash: ctx.ipHash,
        // Which factor failed goes in the protected log, never in the response.
        metadata: { passwordOk, totpOk, knownUser: Boolean(admin) },
      });
      throw AppError.invalidCredential('admin login failed', {
        username,
        passwordOk,
        totpOk,
      });
    }

    const token = issueOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.config.adminSessionTtlMinutes * 60 * 1000,
    );

    await this.prisma.$transaction([
      this.prisma.admin.update({
        where: { id: admin.id },
        data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      }),
      this.prisma.adminSession.create({
        data: {
          adminId: admin.id,
          tokenHash: toDbBytes(token.hash),
          expiresAt,
          ipHash: ctx.ipHash,
          // Logging in counts as a step-up: the admin just presented both
          // factors. The clock starts now.
          stepUpAt: new Date(),
        },
      }),
    ]);

    await this.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      event: AuditEvent.ADMIN_LOGIN_SUCCESS,
      result: 'success',
      ipHash: ctx.ipHash,
    });

    return { token: token.value, expiresAt };
  }

  /**
   * Re-present both factors to refresh the step-up window before a destructive
   * operation. Required regardless of how recently the admin logged in, so an
   * unattended open console is not a path to changing the master password.
   */
  async stepUp(
    adminId: string,
    sessionId: string,
    password: string,
    totp: string,
    ctx: VaultRequestContext,
  ): Promise<{ stepUpUntil: Date }> {
    const admin = await this.prisma.admin.findUniqueOrThrow({ where: { id: adminId } });

    const ok =
      (await this.passwords.verify(admin.passwordHash, password)) &&
      this.verifyTotp(admin.totpSecretEnc, totp);

    if (!ok) {
      await this.audit.record({
        actorType: 'admin',
        actorId: adminId,
        event: AuditEvent.ADMIN_STEPUP,
        result: 'failure',
        ipHash: ctx.ipHash,
      });
      throw AppError.invalidCredential('step-up authentication failed', { adminId });
    }

    const now = new Date();
    await this.prisma.adminSession.update({
      where: { id: sessionId },
      data: { stepUpAt: now },
    });

    await this.audit.record({
      actorType: 'admin',
      actorId: adminId,
      event: AuditEvent.ADMIN_STEPUP,
      result: 'success',
      ipHash: ctx.ipHash,
    });

    return {
      stepUpUntil: new Date(now.getTime() + this.config.adminStepUpTtlSeconds * 1000),
    };
  }

  async logout(sessionId: string, adminId: string, ctx: VaultRequestContext): Promise<void> {
    await this.prisma.adminSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorType: 'admin',
      actorId: adminId,
      event: AuditEvent.ADMIN_LOGOUT,
      result: 'success',
      ipHash: ctx.ipHash,
    });
  }
}
