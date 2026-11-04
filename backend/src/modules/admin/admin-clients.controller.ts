import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { AdminClientsService } from './admin-clients.service';
import { CreateClientDto, SetClientAccessDto } from './dto/admin.dto';
import {
  AdminRoute,
  Ctx,
  RequiresStepUp,
} from '../../common/decorators/route.decorators';
import type { VaultRequestContext } from '../../common/request-context';

@Controller('admin')
export class AdminClientsController {
  constructor(private readonly clients: AdminClientsService) {}

  /// The fixed category vocabulary. Needed by the console for the upload form
  /// and the per-client access editor; the client-facing `/categories` route
  /// only ever returns what that client can reach.
  @Get('categories')
  @AdminRoute()
  categories() {
    return this.clients.categories();
  }

  @Get('clients')
  @AdminRoute()
  list() {
    return this.clients.list();
  }

  @Post('clients')
  @AdminRoute()
  @HttpCode(201)
  create(@Body() dto: CreateClientDto, @Ctx() ctx: VaultRequestContext) {
    return this.clients.create(ctx.admin!.id, dto, ctx);
  }

  @Post('clients/:id/enrollment-code')
  @AdminRoute()
  @HttpCode(200)
  issueCode(@Param('id') id: string, @Ctx() ctx: VaultRequestContext) {
    return this.clients.issueCode(ctx.admin!.id, id, ctx);
  }

  @Get('clients/:id/devices')
  @AdminRoute()
  devices(@Param('id') id: string) {
    return this.clients.listDevices(id);
  }

  @Get('clients/:id/access')
  @AdminRoute()
  getAccess(@Param('id') id: string) {
    return this.clients.getAccess(id);
  }

  @Put('clients/:id/access')
  @AdminRoute()
  setAccess(@Param('id') id: string, @Body() dto: SetClientAccessDto) {
    return this.clients.setAccess(id, dto);
  }

  @Post('clients/:id/revoke')
  @AdminRoute()
  @RequiresStepUp()
  @HttpCode(204)
  async revokeClient(@Param('id') id: string, @Ctx() ctx: VaultRequestContext) {
    await this.clients.revokeClient(ctx.admin!.id, id, ctx);
  }

  @Post('devices/:id/revoke')
  @AdminRoute()
  @HttpCode(204)
  async revokeDevice(@Param('id') id: string, @Ctx() ctx: VaultRequestContext) {
    await this.clients.revokeDevice(ctx.admin!.id, id, ctx);
  }
}
