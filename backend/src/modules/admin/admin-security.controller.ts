import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { DmpService, ALLOWED_GRANT_TTLS } from '../vault/dmp.service';
import { GrantService } from '../vault/grant.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuditQueryDto,
  ChangeMasterPasswordDto,
  GrantTtlDto,
  SetMasterPasswordDto,
} from './dto/admin.dto';
import {
  AdminRoute,
  Ctx,
  RequiresStepUp,
} from '../../common/decorators/route.decorators';
import { AppError } from '../../common/errors/app-error';
import type { VaultRequestContext } from '../../common/request-context';

/**
 * Document Master Password management — the administrator's exclusive
 * territory (§4, §7, §12).
 *
 * Every route here lives under the `admin/` path prefix, is guarded by
 * `AdminAuthGuard`, and the mutating ones additionally require a fresh step-up.
 * There is no counterpart to any of this on the client surface.
 */
@Controller('admin/security')
export class AdminSecurityController {
  constructor(
    private readonly dmp: DmpService,
    private readonly grants: GrantService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  /** Status only. The password itself has no representation that can be read. */
  @Get('master-password')
  @AdminRoute()
  async status() {
    const s = await this.dmp.status();
    return {
      configured: s.configured,
      version: s.dmpVersion,
      grantTtlSeconds: s.grantTtlSeconds,
      allowedGrantTtls: ALLOWED_GRANT_TTLS,
      activeDocumentSessions: await this.grants.countActive(),
    };
  }

  @Post('master-password')
  @AdminRoute()
  @RequiresStepUp()
  @HttpCode(204)
  async setInitial(
    @Body() dto: SetMasterPasswordDto,
    @Ctx() ctx: VaultRequestContext,
  ): Promise<void> {
    await this.dmp.setInitial(ctx.admin!.id, dto.password, ctx);
  }

  @Put('master-password')
  @AdminRoute()
  @RequiresStepUp()
  @HttpCode(200)
  async change(
    @Body() dto: ChangeMasterPasswordDto,
    @Ctx() ctx: VaultRequestContext,
  ) {
    if (dto.newPassword !== dto.confirmNewPassword) {
      throw AppError.invalidRequest('new master password confirmation mismatch');
    }
    const result = await this.dmp.change(
      ctx.admin!.id,
      dto.currentPassword,
      dto.newPassword,
      ctx,
    );
    return {
      version: result.dmpVersion,
      invalidatedDocumentSessions: result.invalidatedGrants,
    };
  }

  @Put('grant-ttl')
  @AdminRoute()
  @HttpCode(204)
  async setTtl(@Body() dto: GrantTtlDto, @Ctx() ctx: VaultRequestContext): Promise<void> {
    await this.dmp.setGrantTtl(ctx.admin!.id, dto.seconds, ctx);
  }

  /** §27: force every client to re-enter the master password, right now. */
  @Post('invalidate-all-grants')
  @AdminRoute()
  @RequiresStepUp()
  @HttpCode(200)
  async invalidateAll(@Ctx() ctx: VaultRequestContext) {
    const count = await this.dmp.invalidateAllGrants(ctx.admin!.id, ctx);
    return { invalidatedDocumentSessions: count };
  }

  @Get('audit-log')
  @AdminRoute()
  async auditLog(@Query() query: AuditQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const where = {
      ...(query.event ? { event: query.event } : {}),
      ...(query.result ? { result: query.result } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      total,
      page,
      limit,
      items: rows.map((r) => ({
        id: r.id.toString(),
        at: r.at.toISOString(),
        actorType: r.actorType,
        actorId: r.actorId,
        deviceId: r.deviceId,
        event: r.event,
        targetType: r.targetType,
        targetId: r.targetId,
        result: r.result,
        metadata: r.metadata,
      })),
    };
  }

  /** Confirms nobody has quietly removed an inconvenient row. */
  @Get('audit-log/verify')
  @AdminRoute()
  verifyChain() {
    return this.audit.verifyChain();
  }
}
