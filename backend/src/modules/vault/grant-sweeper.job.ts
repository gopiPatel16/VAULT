import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GrantService } from './grant.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Housekeeping.
 *
 * Expired grants are already refused by `GrantService.validate` — expiry is
 * enforced at read time, never by a background job. This only reclaims rows, so
 * if the scheduler never ran, nothing would become accessible that should not
 * be.
 */
@Injectable()
export class GrantSweeper {
  private readonly logger = new Logger(GrantSweeper.name);

  constructor(
    private readonly grants: GrantService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    try {
      const grants = await this.grants.purgeExpired(24);

      // Master-password attempt records exist for rate limiting, not history.
      const attempts = await this.prisma.dmpAttempt.deleteMany({
        where: { at: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      });

      const sessions = await this.prisma.session.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      });

      if (grants || attempts.count || sessions.count) {
        this.logger.log(
          `Swept ${grants} grant(s), ${attempts.count} attempt record(s), ` +
            `${sessions.count} expired session(s)`,
        );
      }
    } catch (err) {
      this.logger.error(`Sweep failed: ${(err as Error).message}`);
    }
  }
}
