import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { sha256 } from '../../common/crypto/hashing';
import { fromDbBytes, toDbBytes } from '../../common/crypto/bytes';

/**
 * Audit events. The vocabulary is closed — adding one means deciding it is
 * worth keeping forever.
 */
export const AuditEvent = {
  CLIENT_ENROLLED: 'client.enrolled',
  CLIENT_LOGIN_SUCCESS: 'client.login.success',
  CLIENT_LOGIN_FAILURE: 'client.login.failure',
  CLIENT_LOGOUT: 'client.logout',
  CLIENT_REFRESH_REUSE: 'client.refresh.reuse_detected',
  CLIENT_REVOKED: 'client.revoked',

  DEVICE_REVOKED: 'device.revoked',
  DEVICE_REJECTED: 'device.rejected',

  DMP_VERIFY_SUCCESS: 'dmp.verify.success',
  DMP_VERIFY_FAILURE: 'dmp.verify.failure',
  DMP_CONFIGURED: 'dmp.configured',
  DMP_CHANGED: 'dmp.changed',
  DMP_TTL_CHANGED: 'dmp.ttl_changed',
  DMP_GRANTS_INVALIDATED: 'dmp.grants_invalidated',

  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_VIEWED: 'document.viewed',
  DOCUMENT_DOWNLOADED: 'document.downloaded',
  DOCUMENT_DELETED: 'document.deleted',
  DOCUMENT_UPDATED: 'document.updated',
  DOCUMENT_ACCESS_DENIED: 'document.access_denied',

  ADMIN_LOGIN_SUCCESS: 'admin.login.success',
  ADMIN_LOGIN_FAILURE: 'admin.login.failure',
  ADMIN_STEPUP: 'admin.stepup',
  ADMIN_LOGOUT: 'admin.logout',

  RATE_LIMITED: 'security.rate_limited',
} as const;

export type AuditEventValue = (typeof AuditEvent)[keyof typeof AuditEvent];

export interface AuditEntry {
  actorType: 'admin' | 'client' | 'system';
  actorId?: string | null;
  deviceId?: string | null;
  event: AuditEventValue;
  targetType?: string | null;
  targetId?: string | null;
  result: 'success' | 'failure';
  ipHash?: string | null;
  /** Never secrets, never document contents, never password material. */
  metadata?: Record<string, unknown>;
}

/** Advisory lock id, so chained appends serialise across connections. */
const AUDIT_LOCK_KEY = 0x5641554c; // "VAUL"

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append a tamper-evident entry.
   *
   * Each row's hash covers the previous row's hash, so removing or editing any
   * historical entry breaks the chain from that point on and `verifyChain`
   * will say where. This does not stop an attacker with database write access
   * from rewriting the whole chain — for that the log has to leave the
   * machine — but it does defeat selective deletion of an inconvenient row.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;

        const prev = await tx.auditLog.findFirst({
          orderBy: { id: 'desc' },
          select: { entryHash: true },
        });
        const prevHash = prev?.entryHash ?? null;
        const at = new Date();

        const canonical: string = JSON.stringify({
          at: at.toISOString(),
          actorType: entry.actorType,
          actorId: entry.actorId ?? null,
          deviceId: entry.deviceId ?? null,
          event: entry.event,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          result: entry.result,
          ipHash: entry.ipHash ?? null,
          metadata: entry.metadata ?? {},
          prev: prevHash ? fromDbBytes(prevHash).toString('base64') : null,
        });

        await tx.auditLog.create({
          data: {
            at,
            actorType: entry.actorType,
            actorId: entry.actorId ?? null,
            deviceId: entry.deviceId ?? null,
            event: entry.event,
            targetType: entry.targetType ?? null,
            targetId: entry.targetId ?? null,
            result: entry.result,
            ipHash: entry.ipHash ?? null,
            metadata: (entry.metadata ?? {}) as object,
            prevHash,
            entryHash: toDbBytes(sha256(canonical)),
          },
        });
      });
    } catch (err) {
      // An audit write must never break the request it describes, but a
      // silently missing audit trail is its own incident — so it is logged
      // loudly on the server.
      this.logger.error(
        `AUDIT WRITE FAILED for ${entry.event}: ${(err as Error).message}`,
      );
    }
  }

  /** Walk the chain and report the first row whose hash does not line up. */
  async verifyChain(): Promise<{ ok: boolean; brokenAtId?: string; checked: number }> {
    const pageSize = 500;
    let cursor: bigint | undefined;
    let prevHash: Uint8Array | null = null;
    let checked = 0;

    for (;;) {
      const rows = await this.prisma.auditLog.findMany({
        take: pageSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        const canonical: string = JSON.stringify({
          at: row.at.toISOString(),
          actorType: row.actorType,
          actorId: row.actorId,
          deviceId: row.deviceId,
          event: row.event,
          targetType: row.targetType,
          targetId: row.targetId,
          result: row.result,
          ipHash: row.ipHash,
          metadata: row.metadata ?? {},
          prev: prevHash ? fromDbBytes(prevHash).toString('base64') : null,
        });
        if (!sha256(canonical).equals(row.entryHash)) {
          return { ok: false, brokenAtId: row.id.toString(), checked };
        }
        prevHash = row.entryHash;
        checked += 1;
      }
      cursor = rows[rows.length - 1].id;
    }
    return { ok: true, checked };
  }
}
