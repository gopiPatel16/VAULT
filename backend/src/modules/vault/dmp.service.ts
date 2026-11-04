import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../../common/crypto/password.service';
import { GrantService } from './grant.service';
import { AuditService, AuditEvent } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import type { VaultRequestContext } from '../../common/request-context';

/**
 * The Document Master Password.
 *
 * Ownership rules, enforced structurally rather than by role checks:
 *   * `verify()` is the ONLY method reachable from the client surface, and it
 *     returns a grant, never anything about the password itself.
 *   * every mutating method takes an `adminId` and is only wired into the
 *     administrator router.
 *
 * There is no method on this service — and no route anywhere in the
 * application — that lets a client set, change, reset, recover or read the
 * master password. That is the property §13 asks for, and absence is a
 * stronger guarantee than a permission check.
 */

/** Allowed grant lifetimes, in seconds (ARCHITECTURE §15). */
export const ALLOWED_GRANT_TTLS = [60, 300, 900, 1800] as const;

const MIN_LENGTH = 8;
const MAX_FAILURES_PER_DEVICE = 5;
const MAX_FAILURES_PER_CLIENT = 10;
const FAILURE_WINDOW_MINUTES = 15;

@Injectable()
export class DmpService {
  private readonly logger = new Logger(DmpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly grants: GrantService,
    private readonly audit: AuditService,
  ) {}

  private async settings() {
    const row = await this.prisma.vaultSecret.findUnique({ where: { id: 1 } });
    if (!row) {
      // The single row is created by the migration. Its absence is a broken
      // deployment, and the safe reading of "no master password row" is
      // "nothing is unlocked", never "everything is".
      throw AppError.unavailable('vault_secret row missing');
    }
    return row;
  }

  async status(): Promise<{ configured: boolean; grantTtlSeconds: number; dmpVersion: number }> {
    const s = await this.settings();
    return {
      configured: s.dmpHash !== null,
      grantTtlSeconds: s.grantTtlSeconds,
      dmpVersion: s.dmpVersion,
    };
  }

  // ── Client-reachable: verification only ───────────────────────────────────

  /**
   * Verify a submitted password and, if correct, issue a short-lived grant.
   *
   * The client learns exactly one bit: correct or not. Never why, never
   * whether a master password has been configured at all, never anything
   * about the stored representation.
   */
  async verify(
    password: string,
    ctx: VaultRequestContext,
  ): Promise<{ grant: string; expiresAt: Date; expiresInSeconds: number }> {
    const clientId = ctx.client!.id;
    const deviceId = ctx.device!.id;

    await this.assertNotLockedOut(clientId, deviceId);

    const s = await this.settings();

    // If no master password has been configured the vault fails CLOSED. The
    // Argon2 work still happens so an unconfigured deployment is not
    // detectable by response timing.
    const ok = s.dmpHash
      ? await this.passwords.verify(s.dmpHash, password)
      : ((await this.passwords.burnTime()), false);

    await this.prisma.dmpAttempt.create({
      data: { clientId, deviceId, ipHash: ctx.ipHash, success: ok },
    });

    if (!ok) {
      await this.audit.record({
        actorType: 'client',
        actorId: clientId,
        deviceId,
        event: AuditEvent.DMP_VERIFY_FAILURE,
        result: 'failure',
        ipHash: ctx.ipHash,
      });
      throw AppError.invalidCredential('document master password rejected', {
        clientId,
        deviceId,
        configured: s.dmpHash !== null,
      });
    }

    const grant = await this.grants.issue({
      clientId,
      deviceId,
      sessionId: ctx.session!.id,
      dmpVersion: s.dmpVersion,
      ttlSeconds: s.grantTtlSeconds,
    });

    await this.audit.record({
      actorType: 'client',
      actorId: clientId,
      deviceId,
      event: AuditEvent.DMP_VERIFY_SUCCESS,
      result: 'success',
      ipHash: ctx.ipHash,
      metadata: { ttlSeconds: s.grantTtlSeconds },
    });

    return {
      grant: grant.token,
      expiresAt: grant.expiresAt,
      expiresInSeconds: s.grantTtlSeconds,
    };
  }

  /**
   * Durable brute-force accounting, backed by the database rather than the
   * in-memory rate limiter, so restarting the process does not hand an
   * attacker a fresh budget.
   */
  private async assertNotLockedOut(clientId: string, deviceId: string): Promise<void> {
    const since = new Date(Date.now() - FAILURE_WINDOW_MINUTES * 60 * 1000);

    const [deviceFailures, clientFailures] = await Promise.all([
      this.prisma.dmpAttempt.count({
        where: { deviceId, success: false, at: { gte: since } },
      }),
      this.prisma.dmpAttempt.count({
        where: { clientId, success: false, at: { gte: since } },
      }),
    ]);

    if (
      deviceFailures >= MAX_FAILURES_PER_DEVICE ||
      clientFailures >= MAX_FAILURES_PER_CLIENT
    ) {
      // Reported as an ordinary rejection, not as "you are locked out". A
      // lockout notice tells an attacker their guesses are being counted and
      // exactly when to resume.
      throw AppError.invalidCredential('master password attempts exhausted', {
        clientId,
        deviceId,
        deviceFailures,
        clientFailures,
      });
    }
  }

  // ── Administrator-only: configuration ─────────────────────────────────────

  private validatePolicy(password: string): void {
    if (password.length < MIN_LENGTH) {
      throw AppError.invalidRequest(
        `master password must be at least ${MIN_LENGTH} characters`,
      );
    }
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
      re.test(password),
    ).length;
    // Shorter passwords have to work harder. A long passphrase is strong
    // without symbol soup, so length substitutes for character-class variety
    // rather than stacking on top of it.
    //
    // Eight characters is the floor because this password gets typed every
    // time someone opens a document, and a floor people route around is worse
    // than a lower one they keep. What makes eight defensible here is what
    // sits behind it: Argon2id at roughly half a second per guess, five
    // attempts per device before lockout, and a durable attempt counter that
    // a restart does not clear.
    if (password.length < 16 && classes < 3) {
      throw AppError.invalidRequest(
        'master password needs three character classes, or sixteen-plus characters',
      );
    }
    if (/^(.)\1+$/.test(password)) {
      throw AppError.invalidRequest('master password is a single repeated character');
    }
  }

  async setInitial(adminId: string, password: string, ctx: VaultRequestContext): Promise<void> {
    const s = await this.settings();
    if (s.dmpHash) {
      throw AppError.conflict('master password already configured; use change');
    }
    this.validatePolicy(password);

    await this.prisma.vaultSecret.update({
      where: { id: 1 },
      data: {
        dmpHash: await this.passwords.hash(password),
        dmpVersion: 1,
        configuredAt: new Date(),
        updatedAt: new Date(),
        updatedBy: adminId,
      },
    });

    await this.audit.record({
      actorType: 'admin',
      actorId: adminId,
      event: AuditEvent.DMP_CONFIGURED,
      result: 'success',
      ipHash: ctx.ipHash,
    });
  }

  /**
   * Change the master password and lock every client out of document contents
   * at the moment the transaction commits (§12).
   *
   * Two independent mechanisms do that job: the version bump, which makes
   * every outstanding grant fail its generation check, and the explicit
   * revocation sweep. Either alone would suffice; both are present so that a
   * bug in one does not leave document access open.
   */
  async change(
    adminId: string,
    currentPassword: string,
    newPassword: string,
    ctx: VaultRequestContext,
  ): Promise<{ invalidatedGrants: number; dmpVersion: number }> {
    const s = await this.settings();
    if (!s.dmpHash) {
      throw AppError.conflict('master password not configured yet');
    }

    if (!(await this.passwords.verify(s.dmpHash, currentPassword))) {
      await this.audit.record({
        actorType: 'admin',
        actorId: adminId,
        event: AuditEvent.DMP_CHANGED,
        result: 'failure',
        ipHash: ctx.ipHash,
        metadata: { reason: 'current password incorrect' },
      });
      throw AppError.invalidCredential('current master password incorrect', { adminId });
    }

    this.validatePolicy(newPassword);
    if (newPassword === currentPassword) {
      throw AppError.invalidRequest('new master password must differ from the current one');
    }

    const newHash = await this.passwords.hash(newPassword);
    const now = new Date();

    const [revocation, updated] = await this.prisma.$transaction([
      this.prisma.documentGrant.updateMany({
        where: { revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.vaultSecret.update({
        where: { id: 1 },
        data: {
          dmpHash: newHash,
          dmpVersion: { increment: 1 },
          updatedAt: now,
          updatedBy: adminId,
        },
      }),
    ]);
    const revoked = revocation.count;

    await this.audit.record({
      actorType: 'admin',
      actorId: adminId,
      event: AuditEvent.DMP_CHANGED,
      result: 'success',
      ipHash: ctx.ipHash,
      metadata: { dmpVersion: updated.dmpVersion, invalidatedGrants: revoked },
    });

    this.logger.warn(
      `Document master password changed by admin ${adminId}; ` +
        `${revoked} document session(s) invalidated`,
    );

    return { invalidatedGrants: revoked, dmpVersion: updated.dmpVersion };
  }

  async setGrantTtl(
    adminId: string,
    seconds: number,
    ctx: VaultRequestContext,
  ): Promise<void> {
    if (!(ALLOWED_GRANT_TTLS as readonly number[]).includes(seconds)) {
      throw AppError.invalidRequest('unsupported grant lifetime');
    }
    await this.prisma.vaultSecret.update({
      where: { id: 1 },
      data: { grantTtlSeconds: seconds, updatedAt: new Date(), updatedBy: adminId },
    });
    await this.audit.record({
      actorType: 'admin',
      actorId: adminId,
      event: AuditEvent.DMP_TTL_CHANGED,
      result: 'success',
      ipHash: ctx.ipHash,
      metadata: { seconds },
    });
  }

  async invalidateAllGrants(adminId: string, ctx: VaultRequestContext): Promise<number> {
    const count = await this.grants.revokeAll();
    await this.audit.record({
      actorType: 'admin',
      actorId: adminId,
      event: AuditEvent.DMP_GRANTS_INVALIDATED,
      result: 'success',
      ipHash: ctx.ipHash,
      metadata: { count },
    });
    return count;
  }
}
