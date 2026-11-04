import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_KEY, RateLimitRule } from '../decorators/route.decorators';
import { AppError } from '../errors/app-error';
import { RateLimiterService } from '../services/rate-limiter.service';
import { AuditService, AuditEvent } from '../../modules/audit/audit.service';
import type { VaultRequest } from '../request-context';

/**
 * Applies the per-route rate limit rules.
 *
 * Runs before authentication so that an unauthenticated flood cannot force
 * Argon2 work or database lookups. Because it runs first, `device` and
 * `client` identities are only available from the request headers at this
 * point — that is fine, since those keys exist to give an authenticated
 * attacker a tighter budget, not to be the sole defence.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!rules?.length) return true;

    const req = context.switchToHttp().getRequest<VaultRequest>();
    const headerDevice = String(req.headers['x-device-id'] ?? 'anon');

    for (const rule of rules) {
      for (const by of rule.by) {
        const identity =
          by === 'ip'
            ? req.vault.ipHash
            : by === 'device'
              ? headerDevice
              : by === 'client'
                ? (req.vault.client?.id ?? headerDevice)
                : 'global';

        const verdict = this.limiter.consume(
          `${rule.name}:${by}:${identity}`,
          rule.limit,
          rule.windowSeconds,
        );

        if (!verdict.allowed) {
          await this.audit.record({
            actorType: req.vault.client ? 'client' : 'system',
            actorId: req.vault.client?.id ?? null,
            event: AuditEvent.RATE_LIMITED,
            result: 'failure',
            ipHash: req.vault.ipHash,
            metadata: { bucket: rule.name, by },
          });
          // No Retry-After header: it would tell an attacker exactly how long
          // to sleep before resuming. The internal value is logged instead.
          throw AppError.tooManyRequests(
            `rate limit ${rule.name} exceeded by ${by}`,
            { retryAfterSeconds: verdict.retryAfterSeconds },
          );
        }
      }
    }
    return true;
  }
}
