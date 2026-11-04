import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { EnrollDto, LoginDto, RefreshDto } from './dto/auth.dto';
import {
  ClientRoute,
  Ctx,
  DeviceRoute,
  EnrollmentRoute,
  RateLimit,
} from '../../common/decorators/route.decorators';
import type { VaultRequestContext } from '../../common/request-context';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('enroll')
  @EnrollmentRoute()
  @RateLimit({ name: 'enroll', limit: 5, windowSeconds: 900, by: ['ip'] })
  @HttpCode(200)
  enroll(@Body() dto: EnrollDto, @Ctx() ctx: VaultRequestContext) {
    return this.auth.enroll(dto, ctx);
  }

  @Post('login')
  @DeviceRoute()
  @RateLimit(
    { name: 'login', limit: 10, windowSeconds: 900, by: ['ip', 'device'] },
    { name: 'login-global', limit: 60, windowSeconds: 900, by: ['global'] },
  )
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Ctx() ctx: VaultRequestContext) {
    return this.auth.login(dto, ctx);
  }

  @Post('refresh')
  @DeviceRoute()
  @RateLimit({ name: 'refresh', limit: 60, windowSeconds: 900, by: ['device'] })
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Ctx() ctx: VaultRequestContext) {
    return this.auth.refresh(dto, ctx);
  }

  @Post('logout')
  @ClientRoute()
  @HttpCode(204)
  async logout(@Ctx() ctx: VaultRequestContext): Promise<void> {
    await this.auth.logout(ctx);
  }

  /**
   * Everything the client is allowed to know about itself. No account
   * identifiers beyond a display name, nothing about the deployment.
   */
  @Get('me')
  @ClientRoute()
  me(@Ctx() ctx: VaultRequestContext) {
    return {
      displayName: ctx.client!.displayName,
      deviceName: ctx.device!.name,
    };
  }
}
