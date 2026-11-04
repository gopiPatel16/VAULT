import {
  AdminFixture,
  dump,
  ClientFixture,
  Harness,
  MASTER_PASSWORD,
  adminRequest,
  createAdminAndLogin,
  enrollClient,
  resetDatabase,
  setMasterPassword,
  signedRequest,
  startHarness,
  unlock,
  uploadDocument,
} from '../helpers/harness';

describe('Layer 2 — Document Master Password', () => {
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

  const tryUnlock = (password: string) =>
    signedRequest(h.server, {
      method: 'post',
      path: '/vault/unlock',
      keys: client.keys,
      deviceId: client.deviceId,
      accessToken: client.accessToken,
      body: { password },
    });

  describe('verification', () => {
    it('fails closed when no master password has been configured', async () => {
      const res = await tryUnlock(MASTER_PASSWORD);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIAL');

      const grants = await h.prisma.documentGrant.count();
      expect(grants).toBe(0);
    });

    it('issues an opaque grant for the correct password', async () => {
      await setMasterPassword(h, admin);
      const res = await tryUnlock(MASTER_PASSWORD).expect(200);

      expect(res.body.expiresInSeconds).toBe(300);
      expect(typeof res.body.grant).toBe('string');

      // Not a JWT, and not decodable into anything the client can read.
      expect(res.body.grant.split('.')).toHaveLength(1);
      expect(res.body.grant).not.toContain(MASTER_PASSWORD);

      const stored = await h.prisma.documentGrant.findFirstOrThrow();
      // Only a digest is persisted, so a database dump yields no usable grant.
      expect(Buffer.from(stored.tokenHash).toString('base64url')).not.toBe(res.body.grant);
      expect(stored.dmpVersion).toBe(1);
      expect(stored.clientId).toBe(client.clientId);
      expect(stored.deviceId).toBe(client.deviceId);
    });

    it('rejects a wrong password and issues nothing', async () => {
      await setMasterPassword(h, admin);
      const res = await tryUnlock('definitely-not-it');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIAL');
      expect(Object.keys(res.body.error).sort()).toEqual(['code', 'requestId']);
      expect(await h.prisma.documentGrant.count()).toBe(0);

      const attempt = await h.prisma.dmpAttempt.findFirstOrThrow();
      expect(attempt.success).toBe(false);
    });

    it('never writes the password or a hash of it into the audit trail', async () => {
      await setMasterPassword(h, admin);
      await tryUnlock('wrong-one-here');
      await tryUnlock(MASTER_PASSWORD).expect(200);

      const rows = await h.prisma.auditLog.findMany();
      const dumped = dump(rows);
      expect(dumped).not.toContain(MASTER_PASSWORD);
      expect(dumped).not.toContain('wrong-one-here');
      expect(dumped).not.toMatch(/\$argon2/);
    });
  });

  describe('brute-force resistance', () => {
    it('locks out after repeated failures and refuses even the correct password', async () => {
      await setMasterPassword(h, admin);

      for (let i = 0; i < 5; i++) {
        const res = await tryUnlock(`wrong-attempt-${i}`);
        expect(res.status).toBe(401);
      }

      // The durable counter in `dmp_attempts` — not the in-memory limiter —
      // is what makes this survive a process restart.
      h.limiter.reset();

      const correct = await tryUnlock(MASTER_PASSWORD);
      expect(correct.status).toBe(401);
      expect(correct.body.error.code).toBe('INVALID_CREDENTIAL');
      expect(await h.prisma.documentGrant.count()).toBe(0);
    });

    it('rate limits the unlock endpoint independently of the durable counter', async () => {
      await setMasterPassword(h, admin);

      const codes: number[] = [];
      for (let i = 0; i < 8; i++) {
        const res = await tryUnlock('nope-nope-nope');
        codes.push(res.status);
      }
      expect(codes).toContain(429);
    });
  });

  describe('grant lifetime', () => {
    it('reports only the caller`s own remaining time', async () => {
      await setMasterPassword(h, admin);
      const grant = await unlock(h, client);

      const res = await signedRequest(h.server, {
        method: 'get',
        path: '/vault/status',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
        grant,
      }).expect(200);

      expect(Object.keys(res.body).sort()).toEqual(['expiresAt', 'expiresInSeconds']);
      expect(res.body.expiresInSeconds).toBeLessThanOrEqual(300);
    });

    it('refuses an expired grant', async () => {
      await setMasterPassword(h, admin);
      const grant = await unlock(h, client);

      await h.prisma.documentGrant.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await signedRequest(h.server, {
        method: 'get',
        path: '/vault/status',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
        grant,
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('GRANT_REQUIRED');
    });

    it('does not extend a grant on activity', async () => {
      await setMasterPassword(h, admin);
      const grant = await unlock(h, client);
      const before = await h.prisma.documentGrant.findFirstOrThrow();

      for (let i = 0; i < 3; i++) {
        await signedRequest(h.server, {
          method: 'get',
          path: '/vault/status',
          keys: client.keys,
          deviceId: client.deviceId,
          accessToken: client.accessToken,
          grant,
        }).expect(200);
      }

      const after = await h.prisma.documentGrant.findFirstOrThrow();
      expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
    });

    it('drops the grant when the client locks early', async () => {
      await setMasterPassword(h, admin);
      const grant = await unlock(h, client);

      await signedRequest(h.server, {
        method: 'post',
        path: '/vault/lock',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
      }).expect(204);

      const res = await signedRequest(h.server, {
        method: 'get',
        path: '/vault/status',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
        grant,
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('GRANT_REQUIRED');
    });
  });

  describe('administrator control', () => {
    it('changing the password invalidates every outstanding grant everywhere', async () => {
      await setMasterPassword(h, admin);

      const second = await enrollClient(h, admin, { categorySlugs: ['personal'] });
      const grantA = await unlock(h, client);
      const grantB = await unlock(h, second);
      const doc = await uploadDocument(h, admin);

      // Both clients can read before the change.
      for (const [c, g] of [
        [client, grantA],
        [second, grantB],
      ] as const) {
        await signedRequest(h.server, {
          method: 'get',
          path: `/documents/${doc.id}/content`,
          keys: c.keys,
          deviceId: c.deviceId,
          accessToken: c.accessToken,
          grant: g,
        }).expect(200);
      }

      const changed = await adminRequest(
        h.server,
        admin,
        'put',
        '/admin/security/master-password',
      )
        .send({
          currentPassword: MASTER_PASSWORD,
          newPassword: 'Different-Master-Phrase-42',
          confirmNewPassword: 'Different-Master-Phrase-42',
        })
        .expect(200);

      expect(changed.body.version).toBe(2);
      expect(changed.body.invalidatedDocumentSessions).toBe(2);

      // Neither client can read afterwards.
      for (const [c, g] of [
        [client, grantA],
        [second, grantB],
      ] as const) {
        const res = await signedRequest(h.server, {
          method: 'get',
          path: `/documents/${doc.id}/content`,
          keys: c.keys,
          deviceId: c.deviceId,
          accessToken: c.accessToken,
          grant: g,
        });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('GRANT_REQUIRED');
      }

      // And the new password works.
      await unlock(h, client, 'Different-Master-Phrase-42');
    });

    it('the version check alone blocks a stale grant, independently of revocation', async () => {
      await setMasterPassword(h, admin);
      const grant = await unlock(h, client);

      // Simulate the revocation sweep having failed: only the version moves.
      await h.prisma.vaultSecret.update({
        where: { id: 1 },
        data: { dmpVersion: { increment: 1 } },
      });
      const live = await h.prisma.documentGrant.findFirstOrThrow();
      expect(live.revokedAt).toBeNull();

      const res = await signedRequest(h.server, {
        method: 'get',
        path: '/vault/status',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
        grant,
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('GRANT_REQUIRED');
    });

    it('rejects a change that does not know the current password', async () => {
      await setMasterPassword(h, admin);

      const res = await adminRequest(
        h.server,
        admin,
        'put',
        '/admin/security/master-password',
      ).send({
        currentPassword: 'not-the-current-one',
        newPassword: 'Another-Valid-Phrase-88',
        confirmNewPassword: 'Another-Valid-Phrase-88',
      });

      expect(res.status).toBe(401);
      const secret = await h.prisma.vaultSecret.findUniqueOrThrow({ where: { id: 1 } });
      expect(secret.dmpVersion).toBe(1);
    });

    it('invalidate-all forces every client to re-enter the password', async () => {
      await setMasterPassword(h, admin);
      await unlock(h, client);

      const res = await adminRequest(
        h.server,
        admin,
        'post',
        '/admin/security/invalidate-all-grants',
      ).expect(200);

      expect(res.body.invalidatedDocumentSessions).toBe(1);
      expect(await h.prisma.documentGrant.count({ where: { revokedAt: null } })).toBe(0);
    });

    it('accepts an eight-character password with mixed character classes', async () => {
      await adminRequest(h.server, admin, 'post', '/admin/security/master-password')
        .send({ password: 'Ab3$xyzq' })
        .expect(204);

      // And it genuinely works as the master password.
      await unlock(h, client, 'Ab3$xyzq');
    });

    it('rejects anything shorter than eight', async () => {
      const res = await adminRequest(
        h.server,
        admin,
        'post',
        '/admin/security/master-password',
      ).send({ password: 'Ab3$xyz' });

      expect(res.status).toBe(400);
      const secret = await h.prisma.vaultSecret.findUniqueOrThrow({ where: { id: 1 } });
      expect(secret.dmpHash).toBeNull();
    });

    it('makes a short password earn it: eight lowercase letters is not enough', async () => {
      const res = await adminRequest(
        h.server,
        admin,
        'post',
        '/admin/security/master-password',
      ).send({ password: 'abcdefgh' });

      expect(res.status).toBe(400);
    });

    it('lets a long passphrase skip the character-class rule', async () => {
      await adminRequest(h.server, admin, 'post', '/admin/security/master-password')
        .send({ password: 'sunlit harbour ledger' })
        .expect(204);
    });

    it('only accepts the four documented grant lifetimes', async () => {
      await adminRequest(h.server, admin, 'put', '/admin/security/grant-ttl')
        .send({ seconds: 900 })
        .expect(204);

      await adminRequest(h.server, admin, 'put', '/admin/security/grant-ttl')
        .send({ seconds: 86400 })
        .expect(400);

      const secret = await h.prisma.vaultSecret.findUniqueOrThrow({ where: { id: 1 } });
      expect(secret.grantTtlSeconds).toBe(900);
    });

    it('never returns the master password or its hash from the admin status route', async () => {
      await setMasterPassword(h, admin);
      const res = await adminRequest(
        h.server,
        admin,
        'get',
        '/admin/security/master-password',
      ).expect(200);

      const dumped = JSON.stringify(res.body);
      expect(dumped).not.toContain(MASTER_PASSWORD);
      expect(dumped).not.toMatch(/argon2|hash/i);
      expect(res.body.configured).toBe(true);
      expect(res.body.version).toBe(1);
    });
  });
});
