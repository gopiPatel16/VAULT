import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROUTE_SCOPE_KEY } from '../decorators/route.decorators';
import { AppError } from '../errors/app-error';
import type { RouteScope, VaultRequest } from '../request-context';

/**
 * The fail-closed foundation.
 *
 * Every route must declare a scope with one of the route decorators. A handler
 * added without one is rejected here with a generic 401 and a loud server-side
 * error — so the failure mode of "someone forgot to protect this endpoint" is
 * an endpoint that does not work, not an endpoint that is open.
 *
 * `test/security/route-coverage.spec.ts` asserts the same property statically,
 * so the mistake is caught in CI rather than in production.
 */
@Injectable()
export class RouteScopeGuard implements CanActivate {
  private readonly logger = new Logger(RouteScopeGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<VaultRequest>();

    const scope = this.reflector.getAllAndOverride<RouteScope | undefined>(
      ROUTE_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!scope) {
      this.logger.error(
        `Route ${req.method} ${req.url} (${context.getClass().name}.` +
          `${context.getHandler().name}) declares no scope — refusing to serve it.`,
      );
      throw AppError.unauthorized('route declares no scope', {
        controller: context.getClass().name,
        handler: context.getHandler().name,
      });
    }

    req.vault.scope = scope;
    return true;
  }
}
