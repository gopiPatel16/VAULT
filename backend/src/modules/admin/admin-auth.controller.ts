import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto, AdminStepUpDto } from './dto/admin.dto';
import {
  AdminRoute,
  Ctx,
  Public,
  RateLimit,
} from '../../common/decorators/route.decorators';
import type { VaultRequestContext } from '../../common/request-context';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @Public()
  @RateLimit(
    { name: 'admin-login', limit: 10, windowSeconds: 900, by: ['ip'] },
    { name: 'admin-login-global', limit: 20, windowSeconds: 900, by: ['global'] },
  )
  @HttpCode(200)
  async login(@Body() dto: AdminLoginDto, @Ctx() ctx: VaultRequestContext) {
    const result = await this.auth.login(dto.username, dto.password, dto.totp, ctx);
    return { token: result.token, expiresAt: result.expiresAt.toISOString() };
  }

  @Post('stepup')
  @AdminRoute()
  @RateLimit({ name: 'admin-stepup', limit: 10, windowSeconds: 900, by: ['ip'] })
  @HttpCode(200)
  async stepUp(@Body() dto: AdminStepUpDto, @Ctx() ctx: VaultRequestContext) {
    const result = await this.auth.stepUp(
      ctx.admin!.id,
      ctx.adminSession!.id,
      dto.password,
      dto.totp,
      ctx,
    );
    return { stepUpUntil: result.stepUpUntil.toISOString() };
  }

  @Post('logout')
  @AdminRoute()
  @HttpCode(204)
  async logout(@Ctx() ctx: VaultRequestContext): Promise<void> {
    await this.auth.logout(ctx.adminSession!.id, ctx.admin!.id, ctx);
  }
}
