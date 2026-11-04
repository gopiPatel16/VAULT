import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../../common/crypto/password.service';
import { GrantService } from '../vault/grant.service';
import { AuditService, AuditEvent } from '../audit/audit.service';
import { issueEnrollmentCode } from '../../common/crypto/tokens';
import { AppError } from '../../common/errors/app-error';
import type { VaultRequestContext } from '../../common/request-context';
import type { CreateClientDto, SetClientAccessDto } from './dto/admin.dto';
import { toDbBytes } from '../../common/crypto/bytes';

const ENROLLMENT_CODE_TTL_MINUTES = 15;

@Injectable()
export class AdminClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly grants: GrantService,
    private readonly audit: AuditService,
  ) {}

  async categories() {
    const rows = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((c) => ({ slug: c.slug, name: c.name }));
  }

  async list() {
    const clients = await this.prisma.client.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { devices: true } },
        devices: { select: { lastSeenAt: true } },
      },
    });

    return clients.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      loginId: c.loginId,
      status: c.status,
      maxDevices: c.maxDevices,
      deviceCount: c._count.devices,
      lastSeenAt:
        c.devices
          .map((d) => d.lastSeenAt)
          .filter((d): d is Date => d !== null)
          .sort((a, b) => b.getTime() - a.getTime())[0]
          ?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  async create(adminId: string, dto: CreateClientDto, ctx: VaultRequestContext) {
    const loginId = dto.loginId.trim().toLowerCase();
    const existing = await this.prisma.client.findUnique({ where: { loginId } });
    if (existing) throw AppError.conflict('loginId already in use', { loginId });

    const client = await this.prisma.client.create({
      data: {
        displayName: dto.displayName.trim(),
        loginId,
        passwordHash: await this.passwords.hash(dto.password),
        ...(dto.maxDevices ? { maxDevices: dto.maxDevices } : {}),
      },
    });

    await this.audit.record({
      actorType: 'admin',
      actorId: adminId,
      event: AuditEvent.CLIENT_ENROLLED,
      targetType: 'client',
      targetId: client.id,
      result: 'success',
      ipHash: ctx.ipHash,
      metadata: { action: 'client created' },
    });

    return { id: client.id, displayName: client.displayName, loginId: client.loginId };
  }

  /**
   * Issue a one-time enrolment code.
   *
   * Returned exactly once, in this response, and stored only as a hash. It is
   * short-lived and single-use, and on its own it is not a way in — the device
   * it enrols still has to authenticate with the account password.
   */
  async issueCode(adminId: string, clientId: string, ctx: VaultRequestContext) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client || client.status !== 'active') {
      throw AppError.notFound('client not found or not active', { clientId });
    }

    const code = issueEnrollmentCode();
    const expiresAt = new Date(Date.now() + ENROLLMENT_CODE_TTL_MINUTES * 60 * 1000);

    await this.prisma.enrollmentCode.create({
      data: {
        clientId,
        codeHash: toDbBytes(code.hash),
        expiresAt,
        createdByAdmin: adminId,
      },
    });

    return {
      code: code.value,
      expiresAt: expiresAt.toISOString(),
      expiresInMinutes: ENROLLMENT_CODE_TTL_MINUTES,
    };
  }

  async listDevices(clientId: string) {
    const devices = await this.prisma.device.findMany({
      where: { clientId },
      orderBy: { enrolledAt: 'asc' },
    });
    return devices.map((d) => ({
      id: d.id,
      name: d.name,
      platform: d.platform,
      status: d.status,
      enrolledAt: d.enrolledAt.toISOString(),
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    }));
  }

  /**
   * Revoke a device. Everything it holds dies with it: sessions and any live
   * document grant. The next request from that device is rejected by
   * DeviceStatusGuard with a generic authorisation error.
   */
  async revokeDevice(adminId: string, deviceId: string, ctx: VaultRequestContext) {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw AppError.notFound('device not found', { deviceId });

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.device.update({
        where: { id: deviceId },
        data: { status: 'revoked', revokedAt: now },
      }),
      this.prisma.session.updateMany({
        where: { deviceId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.documentGrant.updateMany({
        where: { deviceId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    await this.audit.record({
      actorType: 'admin',
      actorId: adminId,
      deviceId,
      event: AuditEvent.DEVICE_REVOKED,
      targetType: 'device',
      targetId: deviceId,
      result: 'success',
      ipHash: ctx.ipHash,
    });
  }

  async revokeClient(adminId: string, clientId: string, ctx: VaultRequestContext) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.client.update({
        where: { id: clientId },
        data: { status: 'revoked', revokedAt: now },
      }),
      this.prisma.device.updateMany({
        where: { clientId, status: 'active' },
        data: { status: 'revoked', revokedAt: now },
      }),
      this.prisma.session.updateMany({
        where: { clientId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.documentGrant.updateMany({
        where: { clientId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    await this.audit.record({
      actorType: 'admin',
      actorId: adminId,
      event: AuditEvent.CLIENT_REVOKED,
      targetType: 'client',
      targetId: clientId,
      result: 'success',
      ipHash: ctx.ipHash,
    });
  }

  /** Replaces the client's access grants wholesale. Deny by default means an
   *  empty payload leaves the client able to see nothing at all. */
  async setAccess(clientId: string, dto: SetClientAccessDto) {
    const categories = dto.categorySlugs?.length
      ? await this.prisma.category.findMany({
          where: { slug: { in: dto.categorySlugs.map((s) => s.toLowerCase()) } },
        })
      : [];

    await this.prisma.$transaction([
      this.prisma.clientCategoryAccess.deleteMany({ where: { clientId } }),
      this.prisma.clientDocumentAccess.deleteMany({ where: { clientId } }),
      this.prisma.clientCategoryAccess.createMany({
        data: categories.map((c) => ({ clientId, categoryId: c.id })),
        skipDuplicates: true,
      }),
      this.prisma.clientDocumentAccess.createMany({
        data: (dto.documentIds ?? []).map((documentId) => ({ clientId, documentId })),
        skipDuplicates: true,
      }),
    ]);

    return {
      categories: categories.map((c) => c.slug),
      documents: dto.documentIds?.length ?? 0,
    };
  }

  async getAccess(clientId: string) {
    const [categories, documents] = await Promise.all([
      this.prisma.clientCategoryAccess.findMany({
        where: { clientId },
        include: { category: true },
      }),
      this.prisma.clientDocumentAccess.findMany({ where: { clientId } }),
    ]);
    return {
      categorySlugs: categories.map((c) => c.category.slug),
      documentIds: documents.map((d) => d.documentId),
    };
  }
}
