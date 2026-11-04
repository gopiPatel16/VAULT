import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { DmpService } from './dmp.service';
import { GrantService } from './grant.service';
import {
  ClientRoute,
  Ctx,
  RateLimit,
  RequiresDocumentGrant,
} from '../../common/decorators/route.decorators';
import type { VaultRequestContext } from '../../common/request-context';

class UnlockDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  password!: string;
}

/**
 * The entire client-facing surface of the Document Master Password.
 *
 * Three routes: submit the password, drop the grant early, ask how long the
 * caller's own grant has left. There is no set, change, reset, recover or read
 * route here — not disabled, not permission-gated, absent. A reverse-engineered
 * client cannot reveal a path that does not exist.
 *
 * `test/security/dmp-surface.spec.ts` enumerates the live router and fails if
 * anything resembling password management ever appears on a client route.
 */
@Controller('vault')
export class VaultController {
  constructor(
    private readonly dmp: DmpService,
    private readonly grants: GrantService,
  ) {}

  @Post('unlock')
  @ClientRoute()
  @RateLimit(
    { name: 'dmp-unlock', limit: 5, windowSeconds: 900, by: ['device'] },
    { name: 'dmp-unlock-ip', limit: 15, windowSeconds: 900, by: ['ip'] },
    { name: 'dmp-unlock-global', limit: 30, windowSeconds: 900, by: ['global'] },
  )
  @HttpCode(200)
  async unlock(@Body() dto: UnlockDto, @Ctx() ctx: VaultRequestContext) {
    const result = await this.dmp.verify(dto.password, ctx);
    return {
      grant: result.grant,
      expiresAt: result.expiresAt.toISOString(),
      expiresInSeconds: result.expiresInSeconds,
    };
  }

  /** Client-initiated early lock — for "lock now" and app-background handling. */
  @Post('lock')
  @ClientRoute()
  @HttpCode(204)
  async lock(@Ctx() ctx: VaultRequestContext): Promise<void> {
    await this.grants.revokeBySession(ctx.session!.id);
  }

  /** Only ever describes the caller's own grant. */
  @Get('status')
  @RequiresDocumentGrant()
  status(@Ctx() ctx: VaultRequestContext) {
    return {
      expiresAt: ctx.grant!.expiresAt.toISOString(),
      expiresInSeconds: Math.max(
        0,
        Math.floor((ctx.grant!.expiresAt.getTime() - Date.now()) / 1000),
      ),
    };
  }
}
