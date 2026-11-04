import request from 'supertest';
import {
  AdminFixture,
  ClientFixture,
  Harness,
  PREFIX,
  createAdminAndLogin,
  enrollClient,
  resetDatabase,
  setMasterPassword,
  signedRequest,
  startHarness,
  unlock,
  uploadDocument,
} from '../helpers/harness';

/**
 * Anything matching this must never appear in a response body or header.
 * Driver names, framework names, absolute paths, socket errors, ports.
 */
const LEAK_PATTERN =
  /ECONNREFUSED|ENOENT|EACCES|ETIMEDOUT|EHOSTUNREACH|Connection refused|getaddrinfo|\/Users\/|\/var\/|\/tmp\/|\/home\/|postgres|prisma|PrismaClient|fastify|nestjs|node_modules|at Object\.|localhost:\d+|127\.0\.0\.1|:\d{4}\b/i;

describe('Information leakage', () => {
  let h: Harness;
  let admin: AdminFixture;
  let client: ClientFixture;
  let docId: string;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await resetDatabase(h.prisma);
    h.limiter.reset();
    admin = await createAdminAndLogin(h);
    await setMasterPassword(h, admin);
    client = await enrollClient(h, admin, { categorySlugs: ['personal'] });
    docId = (await uploadDocument(h, admin)).id;
  });

  const expectCleanEnvelope = (res: request.Response): void => {
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(Object.keys(res.body.error).sort()).toEqual(['code', 'requestId']);
    expect(typeof res.body.error.requestId).toBe('string');

    const surface = JSON.stringify(res.body) + JSON.stringify(res.headers);
    expect(surface).not.toMatch(LEAK_PATTERN);
    expect(surface).not.toMatch(/stack|Error:|exception/i);
  };

  describe('error envelope', () => {
    it('returns the fixed shape for an unmatched route', async () => {
      const res = await request(h.server as never).get(`${PREFIX}/does/not/exist`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expectCleanEnvelope(res);
    });

    it('returns the fixed shape for a malformed body', async () => {
      const res = await request(h.server as never)
        .post(`${PREFIX}/admin/auth/login`)
        .set('Content-Type', 'application/json')
        .send('{not json');

      expect(res.status).toBe(400);
      expectCleanEnvelope(res);
    });

    it('returns the fixed shape for a validation failure, naming no fields', async () => {
      const res = await request(h.server as never)
        .post(`${PREFIX}/admin/auth/login`)
        .send({ username: 'x' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
      expectCleanEnvelope(res);
      expect(JSON.stringify(res.body)).not.toMatch(/password|totp|username/i);
    });

    it('returns the fixed shape when authorisation fails', async () => {
      const res = await signedRequest(h.server, {
        method: 'get',
        path: '/documents',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: 'not.a.token',
      });
      expect(res.status).toBe(401);
      expectCleanEnvelope(res);
    });
  });

  describe('backend failures are indistinguishable from a missing document', () => {
    it('reports a vanished blob as an ordinary 404', async () => {
      const grant = await unlock(h, client);

      // Storage layer breaks underneath a document that definitely exists.
      const row = await h.prisma.document.findUniqueOrThrow({ where: { id: docId } });
      await h.prisma.document.update({
        where: { id: docId },
        data: { storageKey: 'aa/bb/does-not-exist.bin' },
      });
      void row;

      const res = await signedRequest(h.server, {
        method: 'get',
        path: `/documents/${docId}/content`,
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
        grant,
      });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expectCleanEnvelope(res);
    });

    it('reports undecryptable key material as an ordinary 404', async () => {
      const grant = await unlock(h, client);

      await h.prisma.document.update({
        where: { id: docId },
        data: { encDek: new Uint8Array(new ArrayBuffer(32)) },
      });

      const res = await signedRequest(h.server, {
        method: 'get',
        path: `/documents/${docId}/content`,
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
        grant,
      });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expectCleanEnvelope(res);
    });

    it('never distinguishes "absent" from "forbidden" from "broken"', async () => {
      const grant = await unlock(h, client);
      const outsider = await enrollClient(h, admin, { categorySlugs: ['finance'] });
      const outsiderGrant = await unlock(h, outsider);

      const absent = await signedRequest(h.server, {
        method: 'get',
        path: '/documents/00000000-0000-4000-8000-000000000000/content',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
        grant,
      });

      const forbidden = await signedRequest(h.server, {
        method: 'get',
        path: `/documents/${docId}/content`,
        keys: outsider.keys,
        deviceId: outsider.deviceId,
        accessToken: outsider.accessToken,
        grant: outsiderGrant,
      });

      expect(absent.status).toBe(forbidden.status);
      expect(absent.body.error.code).toBe(forbidden.body.error.code);
      expect(absent.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('response headers', () => {
    it('carries the hardening headers and no server identification', async () => {
      const res = await signedRequest(h.server, {
        method: 'get',
        path: '/documents',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
      }).expect(200);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");

      expect(res.headers['server']).toBeUndefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('sweep', () => {
    it('no reachable endpoint leaks infrastructure detail in any error state', async () => {
      const paths = [
        '/documents',
        `/documents/${docId}`,
        `/documents/${docId}/content`,
        `/documents/${docId}/preview`,
        '/categories',
        '/auth/me',
        '/vault/status',
        '/vault/unlock',
        '/admin/dashboard',
        '/admin/clients',
        '/admin/security/master-password',
        '/admin/security/audit-log',
        '/does-not-exist',
        // Percent-encoded traversal. A literal '../..' is normalised by the
        // HTTP client before it ever leaves, so the encoded form is what
        // actually reaches the router.
        '/documents/%2e%2e%2f%2e%2e%2fetc%2fpasswd/content',
      ];

      for (const path of paths) {
        // Unauthenticated, then authenticated-but-unauthorised: both must be clean.
        const bare = await request(h.server as never).get(`${PREFIX}${path}`);
        const surface = JSON.stringify(bare.body) + JSON.stringify(bare.headers);
        expect({ path, surface: surface.match(LEAK_PATTERN)?.[0] ?? null }).toEqual({
          path,
          surface: null,
        });
        expect(bare.status).toBeGreaterThanOrEqual(400);
      }
    });
  });
});
