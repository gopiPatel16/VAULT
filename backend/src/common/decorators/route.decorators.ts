import {
  SetMetadata,
  createParamDecorator,
  ExecutionContext,
  applyDecorators,
} from '@nestjs/common';
import type { RouteScope, VaultRequest, VaultRequestContext } from '../request-context';

export const ROUTE_SCOPE_KEY = 'vault:routeScope';
export const REQUIRES_GRANT_KEY = 'vault:requiresGrant';
export const DOCUMENT_RESOURCE_KEY = 'vault:documentResource';
export const REQUIRES_STEPUP_KEY = 'vault:requiresStepUp';
export const RATE_LIMIT_KEY = 'vault:rateLimit';

export const RouteScopeMeta = (scope: RouteScope) =>
  SetMetadata(ROUTE_SCOPE_KEY, scope);

/** No authentication. Use sparingly and deliberately. */
export const Public = () => RouteScopeMeta('public');

/** Device enrolment only: signature checked against the key being enrolled. */
export const EnrollmentRoute = () => RouteScopeMeta('enrollment');

/** Device-signed but not yet bearer-authenticated (login, refresh). */
export const DeviceRoute = () => RouteScopeMeta('device');

/** Layer 1 — authenticated client device. */
export const ClientRoute = () => RouteScopeMeta('client');

/** Administrator surface. */
export const AdminRoute = () => RouteScopeMeta('admin');

/**
 * Layer 2 — the caller must additionally present a valid, unexpired document
 * grant issued under the CURRENT Document Master Password version.
 *
 * Implies `ClientRoute`; the two are applied together so a route can never
 * require a grant without also requiring authentication.
 */
export const RequiresDocumentGrant = () =>
  applyDecorators(RouteScopeMeta('client'), SetMetadata(REQUIRES_GRANT_KEY, true));

/**
 * The route's `:id` parameter names a document. `DocumentResourceGuard` will
 * resolve it through an access-scoped query and attach the row to the request.
 * A document the caller may not have simply does not resolve — 404, always.
 */
export const DocumentResource = () => SetMetadata(DOCUMENT_RESOURCE_KEY, true);

/** Administrator must have re-entered password + TOTP recently. */
export const RequiresStepUp = () => SetMetadata(REQUIRES_STEPUP_KEY, true);

export interface RateLimitRule {
  /** Bucket name; shared across routes that should share a budget. */
  name: string;
  limit: number;
  windowSeconds: number;
  /** What identity the budget is charged against. */
  by: ('ip' | 'device' | 'client' | 'global')[];
}

export const RateLimit = (...rules: RateLimitRule[]) =>
  SetMetadata(RATE_LIMIT_KEY, rules);

// ── Param decorators ────────────────────────────────────────────────────────

export const Ctx = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): VaultRequestContext =>
    ctx.switchToHttp().getRequest<VaultRequest>().vault,
);

export const CurrentClient = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const c = ctx.switchToHttp().getRequest<VaultRequest>().vault.client;
  if (!c) throw new Error('CurrentClient used on a route without client scope');
  return c;
});

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const a = ctx.switchToHttp().getRequest<VaultRequest>().vault.admin;
  if (!a) throw new Error('CurrentAdmin used on a route without admin scope');
  return a;
});

export const CurrentDocument = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => {
    const d = ctx.switchToHttp().getRequest<VaultRequest>().vault.document;
    if (!d) throw new Error('CurrentDocument used without @DocumentResource()');
    return d;
  },
);
