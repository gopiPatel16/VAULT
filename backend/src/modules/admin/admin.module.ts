import { Module } from '@nestjs/common';
import { VaultModule } from '../vault/vault.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminClientsController } from './admin-clients.controller';
import { AdminClientsService } from './admin-clients.service';
import { AdminDocumentsController } from './admin-documents.controller';
import { AdminDocumentsService } from './admin-documents.service';
import { AdminSecurityController } from './admin-security.controller';
import { AdminDashboardController } from './admin-dashboard.controller';

/**
 * The administrator surface, kept in its own module with its own controllers.
 *
 * Nothing here is imported by the client-facing modules, and no client
 * controller imports an admin service. The separation is a property of the
 * dependency graph, not a convention.
 */
@Module({
  imports: [VaultModule],
  controllers: [
    AdminAuthController,
    AdminClientsController,
    AdminDocumentsController,
    AdminSecurityController,
    AdminDashboardController,
  ],
  providers: [AdminAuthService, AdminClientsService, AdminDocumentsService],
})
export class AdminModule {}
