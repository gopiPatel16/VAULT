import request from 'supertest';
import {
  AdminFixture,
  ClientFixture,
  Harness,
  MASTER_PASSWORD,
  PREFIX,
  adminRequest,
  createAdminAndLogin,
  enrollClient,
  resetDatabase,
  setMasterPassword,
  signedRequest,
  startHarness,
} from '../helpers/harness';

describe('Administrator / client separation', () => {
  let h: Harness;
  let admin: AdminFixture;
  let client: ClientFixture;

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
    client = await enrollClient(h, admin, { categorySlugs: ['personal'] });
  });

  describe('credentials do not cross', () => {
    it('a client access token is useless on the admin surface', async () => {
      const res = await request(h.server as never)
        .get(`${PREFIX}/admin/dashboard`)
        .set('authorization', `Bearer ${client.accessToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('an admin token is useless on the client surface', async () => {
      const res = await signedRequest(h.server, {
        method: 'get',
        path: '/documents',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: admin.token,
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('an admin token cannot unlock the vault as a client', async () => {
      await setMasterPassword(h, admin);

      const res = await signedRequest(h.server, {
        method: 'post',
        path: '/vault/unlock',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: admin.token,
        body: { password: MASTER_PASSWORD },
      });

      expect(res.status).toBe(401);
      expect(await h.prisma.documentGrant.count()).toBe(0);
    });

    it('a revoked admin session stops working immediately', async () => {
      await adminRequest(h.server, admin, 'get', '/admin/dashboard').expect(200);
      await adminRequest(h.server, admin, 'post', '/admin/auth/logout').expect(204);

      const res = await adminRequest(h.server, admin, 'get', '/admin/dashboard');
      expect(res.status).toBe(401);
    });
  });

  describe('two-factor', () => {
    it('refuses an admin login with a wrong TOTP code', async () => {
      const res = await request(h.server as never)
        .post(`${PREFIX}/admin/auth/login`)
        .send({ username: admin.username, password: admin.password, totp: '000000' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIAL');
      // The response never says which factor was wrong.
      expect(JSON.stringify(res.body)).not.toMatch(/totp|password/i);
    });

    it('refuses an admin login with a wrong password but valid TOTP', async () => {
      const res = await request(h.server as never)
        .post(`${PREFIX}/admin/auth/login`)
        .send({ username: admin.username, password: 'wrong-password', totp: admin.totp() });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIAL');
    });

    it('locks the account after repeated failures', async () => {
      for (let i = 0; i < 5; i++) {
        await request(h.server as never)
          .post(`${PREFIX}/admin/auth/login`)
          .send({ username: admin.username, password: 'wrong', totp: '000000' });
      }

      const row = await h.prisma.admin.findUniqueOrThrow({ where: { id: admin.id } });
      expect(row.lockedUntil).not.toBeNull();

      const correct = await request(h.server as never)
        .post(`${PREFIX}/admin/auth/login`)
        .send({ username: admin.username, password: admin.password, totp: admin.totp() });
      expect(correct.status).toBe(401);
    });
  });

  describe('step-up for destructive operations', () => {
    /** Pushes the session's step-up timestamp outside the window. */
    const expireStepUp = async (): Promise<void> => {
      await h.prisma.adminSession.updateMany({
        data: { stepUpAt: new Date(Date.now() - 60 * 60 * 1000) },
      });
    };

    it('requires a fresh step-up to set the master password', async () => {
      await expireStepUp();

      const res = await adminRequest(
        h.server,
        admin,
        'post',
        '/admin/security/master-password',
      ).send({ password: MASTER_PASSWORD });

      expect(res.status).toBe(412);
      const secret = await h.prisma.vaultSecret.findUniqueOrThrow({ where: { id: 1 } });
      expect(secret.dmpHash).toBeNull();
    });

    it('requires a fresh step-up to change the master password', async () => {
      await setMasterPassword(h, admin);
      await expireStepUp();

      const res = await adminRequest(
        h.server,
        admin,
        'put',
        '/admin/security/master-password',
      ).send({
        currentPassword: MASTER_PASSWORD,
        newPassword: 'Some-Other-Passphrase-31',
        confirmNewPassword: 'Some-Other-Passphrase-31',
      });

      expect(res.status).toBe(412);
    });

    it('requires a fresh step-up to revoke a client', async () => {
      await expireStepUp();
      const res = await adminRequest(
        h.server,
        admin,
        'post',
        `/admin/clients/${client.clientId}/revoke`,
      );
      expect(res.status).toBe(412);
    });

    it('re-presenting both factors restores the window', async () => {
      await expireStepUp();

      await adminRequest(h.server, admin, 'post', '/admin/auth/stepup')
        .send({ password: admin.password, totp: admin.totp() })
        .expect(200);

      await adminRequest(h.server, admin, 'post', '/admin/security/master-password')
        .send({ password: MASTER_PASSWORD })
        .expect(204);
    });

    it('refuses a step-up with the wrong credentials', async () => {
      const res = await adminRequest(h.server, admin, 'post', '/admin/auth/stepup').send({
        password: 'wrong-password',
        totp: admin.totp(),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('audit trail', () => {
    it('is tamper-evident and rejects a doctored row', async () => {
      await setMasterPassword(h, admin);

      const before = await adminRequest(
        h.server,
        admin,
        'get',
        '/admin/security/audit-log/verify',
      ).expect(200);
      expect(before.body.ok).toBe(true);
      expect(before.body.checked).toBeGreaterThan(0);

      // Quietly rewrite a historical entry, as an attacker covering tracks would.
      const row = await h.prisma.auditLog.findFirstOrThrow({ orderBy: { id: 'asc' } });
      await h.prisma.auditLog.update({
        where: { id: row.id },
        data: { result: 'failure' },
      });

      const after = await adminRequest(
        h.server,
        admin,
        'get',
        '/admin/security/audit-log/verify',
      ).expect(200);
      expect(after.body.ok).toBe(false);
      expect(after.body.brokenAtId).toBe(row.id.toString());
    });

    it('is not reachable from the client surface', async () => {
      const res = await signedRequest(h.server, {
        method: 'get',
        path: '/admin/security/audit-log',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
      });
      expect(res.status).toBe(401);
    });
  });
});
