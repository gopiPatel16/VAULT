import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { Harness, startHarness } from '../helpers/harness';
import {
  ROUTE_SCOPE_KEY,
  REQUIRES_GRANT_KEY,
} from '../../src/common/decorators/route.decorators';
import type { RouteScope } from '../../src/common/request-context';

interface RouteInfo {
  controller: string;
  handler: string;
  path: string;
  scope: RouteScope | undefined;
  requiresGrant: boolean;
}

/**
 * Static assertions over the live router.
 *
 * These are the tests that catch the mistake nobody notices in review: an
 * endpoint added without a scope, or a password-management route appearing on
 * the client surface. Both are invisible in a diff and obvious here.
 */
describe('Route surface', () => {
  let h: Harness;
  let routes: RouteInfo[];

  beforeAll(async () => {
    h = await startHarness();

    const discovery = h.app.get(DiscoveryService);
    const scanner = new MetadataScanner();
    const reflector = h.app.get(Reflector);

    routes = [];
    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance) continue;
      const prototype = Object.getPrototypeOf(instance) as object;
      const controllerPath = Reflect.getMetadata(PATH_METADATA, wrapper.metatype as object) ?? '';

      for (const methodName of scanner.getAllMethodNames(prototype)) {
        const handler = (instance as Record<string, () => unknown>)[methodName];
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;

        const handlerPath = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
        routes.push({
          controller: wrapper.metatype?.name ?? 'unknown',
          handler: methodName,
          path: `/${controllerPath}/${handlerPath}`.replace(/\/+/g, '/').replace(/\/$/, ''),
          scope: reflector.get<RouteScope | undefined>(ROUTE_SCOPE_KEY, handler),
          requiresGrant: reflector.get<boolean | undefined>(REQUIRES_GRANT_KEY, handler) === true,
        });
      }
    }
  });

  afterAll(async () => {
    await h.close();
  });

  it('discovered the expected routes', () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  it('every route declares a scope', () => {
    const undeclared = routes.filter((r) => !r.scope);
    // A route without a scope is refused at runtime by RouteScopeGuard, so the
    // failure mode is already closed. This makes it a build failure instead.
    expect(
      undeclared.map((r) => `${r.controller}.${r.handler} (${r.path})`),
    ).toEqual([]);
  });

  it('no client route offers master-password management', () => {
    const forbidden =
      /(change|reset|recover|forgot|set|remove|update|rotate)[-_]?(master)?[-_]?password|master[-_]?password/i;

    const offenders = routes
      .filter((r) => r.scope !== 'admin')
      .filter((r) => forbidden.test(r.path) || forbidden.test(r.handler));

    expect(offenders.map((r) => `${r.controller}.${r.handler} ${r.path}`)).toEqual([]);
  });

  it('the entire client-facing vault surface is unlock, lock and status', () => {
    const vaultRoutes = routes
      .filter((r) => r.path.startsWith('/vault'))
      .map((r) => r.path)
      .sort();

    expect(vaultRoutes).toEqual(['/vault/lock', '/vault/status', '/vault/unlock']);
  });

  it('master-password management exists only under the admin scope', () => {
    const managed = routes.filter((r) => /master-password/i.test(r.path));

    expect(managed.length).toBeGreaterThan(0);
    for (const route of managed) {
      expect(route.scope).toBe('admin');
      expect(route.path.startsWith('/admin/')).toBe(true);
    }
  });

  it('every route that emits document bytes requires a document grant', () => {
    const byteRoutes = routes.filter((r) => /\/(content|preview)$/.test(r.path));

    expect(byteRoutes.length).toBe(2);
    for (const route of byteRoutes) {
      expect(route.requiresGrant).toBe(true);
      expect(route.scope).toBe('client');
    }
  });

  it('grant-protected routes are always client-scoped', () => {
    for (const route of routes.filter((r) => r.requiresGrant)) {
      expect(route.scope).toBe('client');
    }
  });

  it('there is no health, version, metrics or debug endpoint', () => {
    const probes = routes.filter((r) =>
      /health|healthz|version|metrics|status$|debug|ping|info/i.test(r.path),
    );
    // `/vault/status` is the one permitted match: it describes the caller's own
    // grant and nothing about the deployment.
    expect(probes.map((r) => r.path)).toEqual(['/vault/status']);
  });

  it('no client route can upload', () => {
    const uploads = routes.filter(
      (r) => /upload/i.test(r.path) && r.scope !== 'admin',
    );
    expect(uploads).toEqual([]);
  });
});
