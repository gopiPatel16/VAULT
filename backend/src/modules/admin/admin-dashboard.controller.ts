import { Controller, Get, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GrantService } from '../vault/grant.service';
import { DmpService } from '../vault/dmp.service';
import { STORAGE_DRIVER, StorageDriver } from '../storage/storage.driver';
import { AdminRoute } from '../../common/decorators/route.decorators';

@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grants: GrantService,
    private readonly dmp: DmpService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  @Get()
  @AdminRoute()
  async dashboard() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [documents, clients, devices, usage, security, recentEvents, dmpStatus] =
      await Promise.all([
        this.prisma.document.count({ where: { deletedAt: null } }),
        this.prisma.client.count({ where: { status: 'active' } }),
        this.prisma.device.count({ where: { status: 'active' } }),
        this.storage.usage(),
        this.prisma.auditLog.count({
          where: { at: { gte: since }, result: 'failure' },
        }),
        this.prisma.auditLog.findMany({
          orderBy: { id: 'desc' },
          take: 10,
          select: { at: true, event: true, result: true, actorType: true },
        }),
        this.dmp.status(),
      ]);

    return {
      documents,
      activeClients: clients,
      activeDevices: devices,
      storage: { bytes: usage.bytes, objects: usage.objects },
      activeDocumentSessions: await this.grants.countActive(),
      failedEventsLast24h: security,
      masterPassword: {
        configured: dmpStatus.configured,
        version: dmpStatus.dmpVersion,
        grantTtlSeconds: dmpStatus.grantTtlSeconds,
      },
      recentEvents: recentEvents.map((e) => ({
        at: e.at.toISOString(),
        event: e.event,
        result: e.result,
        actorType: e.actorType,
      })),
    };
  }
}
