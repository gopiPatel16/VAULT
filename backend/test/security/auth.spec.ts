import request from 'supertest';
import {
  ClientFixture,
  Harness,
  PREFIX,
  AdminFixture,
  adminRequest,
  createAdminAndLogin,
  enrollClient,
  generateDeviceKeys,
  resetDatabase,
  signedRequest,
  startHarness,
  CLIENT_PASSWORD,
} from '../helpers/harness';

describe('Layer 1 — client authentication', () => {
  let h: Harness;
  let admin: AdminFixture;

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
  });

  describe('enrolment', () => {
    it('rejects a reused enrolment code', async () => {
      const created = await adminRequest(h.server, admin, 'post', '/admin/clients')
        .send({ displayName: 'A', loginId: 'reuse-test', password: CLIENT_PASSWORD })
        .expect(201);

      const code = (
        await adminRequest(
          h.server,
          admin,
          'post',
          `/admin/clients/${created.body.id}/enrollment-code`,
        ).expect(200)
      ).body.code;

      const enroll = (keys: ReturnType<typeof generateDeviceKeys>) =>
        signedRequest(h.server, {
          method: 'post',
          path: '/auth/enroll',
          keys,
          deviceId: '11111111-1111-4111-8111-111111111111',
          body: { code, publicKey: keys.publicKeyB64, deviceName: 'D', platform: 'ios' },
        });

      await enroll(generateDeviceKeys()).expect(200);

      const second = await enroll(generateDeviceKeys());
      expect(second.status).toBe(401);
      expect(second.body.error.code).toBe('INVALID_CREDENTIAL');
    });

    it('rejects an unknown enrolment code', async () => {
      const keys = generateDeviceKeys();
      const res = await signedRequest(h.server, {
        method: 'post',
        path: '/auth/enroll',
        keys,
        deviceId: '11111111-1111-4111-8111-111111111111',
        body: {
          code: 'ABCDE-FGHJK-MNPQR-STUVW',
          publicKey: keys.publicKeyB64,
          deviceName: 'D',
          platform: 'ios',
        },
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIAL');
    });
  });

  describe('device signatures', () => {
    let client: ClientFixture;

    beforeEach(async () => {
      client = await enrollClient(h, admin);
    });

    it('accepts a correctly signed request', async () => {
      const res = await signedRequest(h.server, {
        method: 'get',
        path: '/auth/me',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
      }).expect(200);

      expect(res.body).toEqual({ displayName: 'Test Client', deviceName: 'Test Device' });
    });

    it('rejects a valid token presented without a signature', async () => {
      const res = await request(h.server as never)
        .get(`${PREFIX}/auth/me`)
        .set('authorization', `Bearer ${client.accessToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it("rejects a signature made with another device's key", async () => {
      const attacker = generateDeviceKeys();
      const res = await signedRequest(h.server, {
        method: 'get',
        path: '/auth/me',
        keys: attacker,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects a signature that does not cover the body actually sent', async () => {
      const url = `${PREFIX}/vault/unlock`;
      const honest = JSON.stringify({ password: 'aaaaaaaaaaaa' });
      const swapped = JSON.stringify({ password: 'bbbbbbbbbbbb' });

      const headers = signedRequest(h.server, {
        method: 'post',
        path: '/vault/unlock',
        keys: client.keys,
        deviceId: client.deviceId,
        body: JSON.parse(honest),
      });
      // Reproduce the signature for the honest body, then send a different one.
      void headers;

      const { signHeaders } = await import('../helpers/harness');
      const sig = signHeaders(client.keys, client.deviceId, 'post', url, honest);

      const res = await request(h.server as never)
        .post(url)
        .set(sig)
        .set('authorization', `Bearer ${client.accessToken}`)
        .set('Content-Type', 'application/json')
        .send(swapped);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects a replayed nonce', async () => {
      const { signHeaders } = await import('../helpers/harness');
      const url = `${PREFIX}/auth/me`;
      const sig = signHeaders(client.keys, client.deviceId, 'get', url, '');

      const send = () =>
        request(h.server as never)
          .get(url)
          .set(sig)
          .set('authorization', `Bearer ${client.accessToken}`);

      await send().expect(200);

      const replay = await send();
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects a stale timestamp', async () => {
      const res = await signedRequest(h.server, {
        method: 'get',
        path: '/auth/me',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
        headerOverrides: { 'x-timestamp': String(Date.now() - 10 * 60 * 1000) },
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('login', () => {
    it('rejects a wrong password with the generic credential error', async () => {
      const client = await enrollClient(h, admin);

      const res = await signedRequest(h.server, {
        method: 'post',
        path: '/auth/login',
        keys: client.keys,
        deviceId: client.deviceId,
        body: { loginId: client.loginId, password: 'not-the-password' },
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIAL');
      expect(Object.keys(res.body.error).sort()).toEqual(['code', 'requestId']);
    });

    it('answers identically for an unknown login id', async () => {
      const client = await enrollClient(h, admin);

      const unknown = await signedRequest(h.server, {
        method: 'post',
        path: '/auth/login',
        keys: client.keys,
        deviceId: client.deviceId,
        body: { loginId: 'nobody-here', password: CLIENT_PASSWORD },
      });

      expect(unknown.status).toBe(401);
      expect(unknown.body.error.code).toBe('INVALID_CREDENTIAL');
    });
  });

  describe('refresh rotation', () => {
    it('rotates the refresh token and detects reuse of the old one', async () => {
      const client = await enrollClient(h, admin);

      const rotated = await signedRequest(h.server, {
        method: 'post',
        path: '/auth/refresh',
        keys: client.keys,
        deviceId: client.deviceId,
        body: { refreshToken: client.refreshToken },
      }).expect(200);

      expect(rotated.body.refreshToken).not.toBe(client.refreshToken);

      // Presenting the retired token is evidence of theft: the whole family dies.
      const reuse = await signedRequest(h.server, {
        method: 'post',
        path: '/auth/refresh',
        keys: client.keys,
        deviceId: client.deviceId,
        body: { refreshToken: client.refreshToken },
      });
      expect(reuse.status).toBe(401);

      const afterReuse = await signedRequest(h.server, {
        method: 'post',
        path: '/auth/refresh',
        keys: client.keys,
        deviceId: client.deviceId,
        body: { refreshToken: rotated.body.refreshToken },
      });
      expect(afterReuse.status).toBe(401);

      const events = await h.prisma.auditLog.findMany({
        where: { event: 'client.refresh.reuse_detected' },
      });
      expect(events).toHaveLength(1);
    });
  });

  describe('revocation', () => {
    it('rejects a revoked device on its very next request', async () => {
      const client = await enrollClient(h, admin);

      await signedRequest(h.server, {
        method: 'get',
        path: '/auth/me',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
      }).expect(200);

      await adminRequest(
        h.server,
        admin,
        'post',
        `/admin/devices/${client.deviceId}/revoke`,
      ).expect(204);

      const res = await signedRequest(h.server, {
        method: 'get',
        path: '/auth/me',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      // Nothing tells the client that revocation, specifically, is what happened.
      expect(JSON.stringify(res.body)).not.toMatch(/revok/i);
    });
  });
});
