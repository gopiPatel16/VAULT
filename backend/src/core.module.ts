import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './config/configuration';
import { PrismaService } from './modules/prisma/prisma.service';
import { PasswordService } from './common/crypto/password.service';
import { EnvelopeCryptoService } from './common/crypto/envelope.service';
import { SignatureService } from './common/crypto/signature.service';
import { RateLimiterService } from './common/services/rate-limiter.service';
import { AuditService } from './modules/audit/audit.service';
import { AccessTokenService } from './modules/auth/access-token.service';
import { STORAGE_DRIVER } from './modules/storage/storage.driver';
import { LocalDiskStorageDriver } from './modules/storage/local-disk.driver';

/**
 * Cross-cutting singletons. Global so guards — which are registered on the
 * root module — can reach them without every feature module re-exporting the
 * same providers.
 */
@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    PrismaService,
    PasswordService,
    EnvelopeCryptoService,
    SignatureService,
    RateLimiterService,
    AuditService,
    AccessTokenService,
    // The one place the storage implementation is chosen. Swapping to S3 or
    // MinIO later is a change to this line.
    { provide: STORAGE_DRIVER, useClass: LocalDiskStorageDriver },
  ],
  exports: [
    APP_CONFIG,
    PrismaService,
    PasswordService,
    EnvelopeCryptoService,
    SignatureService,
    RateLimiterService,
    AuditService,
    AccessTokenService,
    STORAGE_DRIVER,
  ],
})
export class CoreModule {}
