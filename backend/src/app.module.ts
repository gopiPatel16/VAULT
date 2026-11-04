import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { CoreModule } from './core.module';
import { AuthModule } from './modules/auth/auth.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { VaultModule } from './modules/vault/vault.module';
import { AdminModule } from './modules/admin/admin.module';

import { RouteScopeGuard } from './common/guards/route-scope.guard';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { DeviceSignatureGuard } from './common/guards/device-signature.guard';
import { ClientAuthGuard } from './common/guards/client-auth.guard';
import { DeviceStatusGuard } from './common/guards/device-status.guard';
import { AdminAuthGuard } from './common/guards/admin-auth.guard';
import { DocumentGrantGuard } from './common/guards/document-grant.guard';
import { DocumentResourceGuard } from './common/guards/document-resource.guard';

/**
 * The guard chain, in execution order.
 *
 * Nest runs globally registered guards in the order they appear here, and each
 * one either applies to the current route's scope or steps aside. Reordering
 * this array changes the security model, so it is worth reading top to bottom:
 *
 *   1. RouteScopeGuard      — every route must declare a scope, or it is refused
 *   2. RateLimitGuard       — before any expensive work, authenticated or not
 *   3. DeviceSignatureGuard — proof the caller holds the device's private key
 *   4. ClientAuthGuard      — bearer token, bound to the signing device
 *   5. DeviceStatusGuard    — device / client / session still live right now
 *   6. AdminAuthGuard       — the separate administrator credential path
 *   7. DocumentGrantGuard   — Layer 2: the Document Master Password window
 *   8. DocumentResourceGuard— may THIS client have THIS document
 *
 * Layer 2 is checked before the document is resolved, so a caller without a
 * valid grant gets an identical answer for every id — the endpoint cannot be
 * used to find out which documents exist.
 */
@Module({
  imports: [
    CoreModule,
    ScheduleModule.forRoot(),
    AuthModule,
    DocumentsModule,
    VaultModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: RouteScopeGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: DeviceSignatureGuard },
    { provide: APP_GUARD, useClass: ClientAuthGuard },
    { provide: APP_GUARD, useClass: DeviceStatusGuard },
    { provide: APP_GUARD, useClass: AdminAuthGuard },
    { provide: APP_GUARD, useClass: DocumentGrantGuard },
    { provide: APP_GUARD, useClass: DocumentResourceGuard },
  ],
})
export class AppModule {}
