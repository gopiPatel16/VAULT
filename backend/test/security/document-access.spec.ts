import {
  AdminFixture,
  ClientFixture,
  Harness,
  adminRequest,
  createAdminAndLogin,
  enrollClient,
  resetDatabase,
  samplePdf,
  setMasterPassword,
  signedRequest,
  startHarness,
  unlock,
  uploadDocument,
} from '../helpers/harness';

describe('Document access — the two layers together', () => {
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
    docId = (await uploadDocument(h, admin, { title: 'MCA Degree' })).id;
  });

  const asClient = (
    path: string,
    opts: { grant?: string; c?: ClientFixture } = {},
  ) => {
    const c = opts.c ?? client;
    return signedRequest(h.server, {
      method: 'get',
      path,
      keys: c.keys,
      deviceId: c.deviceId,
      accessToken: c.accessToken,
      grant: opts.grant,
    });
  };

  describe('login is not document access', () => {
    it('lists and searches metadata with Layer 1 alone', async () => {
      const list = await asClient('/documents').expect(200);
      expect(list.body.total).toBe(1);
      expect(list.body.items[0].title).toBe('MCA Degree');

      const search = await asClient('/documents?q=mca').expect(200);
      expect(search.body.total).toBe(1);

      const miss = await asClient('/documents?q=nothing-like-this').expect(200);
      expect(miss.body.total).toBe(0);
    });

    it('refuses content to a fully authenticated client with no grant', async () => {
      const res = await asClient(`/documents/${docId}/content`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('GRANT_REQUIRED');
    });

    it('refuses preview to a fully authenticated client with no grant', async () => {
      const res = await asClient(`/documents/${docId}/preview`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('GRANT_REQUIRED');
    });

    it('streams the exact bytes once a grant is presented', async () => {
      const content = samplePdf('the actual document body');
      const other = await uploadDocument(h, admin, { content, filename: 'real.pdf' });
      const grant = await unlock(h, client);

      const res = await asClient(`/documents/${other.id}/content`, { grant }).expect(200);

      expect(Buffer.from(res.body)).toEqual(content);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    });
  });

  describe('the grant is checked before the document is resolved', () => {
    it('answers identically for a real id and a fabricated one', async () => {
      const real = await asClient(`/documents/${docId}/content`);
      const fake = await asClient(
        '/documents/00000000-0000-4000-8000-000000000000/content',
      );

      expect(real.status).toBe(fake.status);
      expect(real.body.error.code).toBe(fake.body.error.code);
      expect(real.body.error.code).toBe('GRANT_REQUIRED');
    });
  });

  describe('IDOR', () => {
    it("returns 404 for another client's document even with a valid grant", async () => {
      const outsider = await enrollClient(h, admin, { categorySlugs: ['finance'] });
      const outsiderGrant = await unlock(h, outsider);

      const res = await asClient(`/documents/${docId}/content`, {
        grant: outsiderGrant,
        c: outsider,
      });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');

      // The administrator, however, does get told: an authenticated client
      // probing for documents it cannot have is exactly the signal to surface.
      const denials = await h.prisma.auditLog.findMany({
        where: { event: 'document.access_denied' },
      });
      expect(denials).toHaveLength(1);
      expect(denials[0].actorId).toBe(outsider.clientId);
    });

    it('hides an unreachable document from metadata routes too', async () => {
      const outsider = await enrollClient(h, admin, { categorySlugs: ['finance'] });

      const list = await asClient('/documents', { c: outsider }).expect(200);
      expect(list.body.total).toBe(0);

      const detail = await asClient(`/documents/${docId}`, { c: outsider });
      expect(detail.status).toBe(404);
    });

    it('treats a malformed id as an ordinary miss, not a database error', async () => {
      const grant = await unlock(h, client);
      const res = await asClient('/documents/not-a-uuid/content', { grant });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('grants nothing by default — a client with no access sees an empty vault', async () => {
      const bare = await enrollClient(h, admin);
      const list = await asClient('/documents', { c: bare }).expect(200);
      expect(list.body.total).toBe(0);

      const categories = await asClient('/categories', { c: bare }).expect(200);
      expect(categories.body).toEqual([]);
    });
  });

  describe('grant binding', () => {
    it("rejects a grant lifted onto another device", async () => {
      const second = await enrollClient(h, admin, { categorySlugs: ['personal'] });
      const stolen = await unlock(h, client);

      const res = await asClient(`/documents/${docId}/content`, {
        grant: stolen,
        c: second,
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('GRANT_REQUIRED');
    });

    it('rejects a fabricated grant token', async () => {
      const res = await asClient(`/documents/${docId}/content`, {
        grant: 'a'.repeat(43),
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('GRANT_REQUIRED');
    });

    it('drops the grant when the device is revoked', async () => {
      const grant = await unlock(h, client);
      await asClient(`/documents/${docId}/content`, { grant }).expect(200);

      await adminRequest(
        h.server,
        admin,
        'post',
        `/admin/devices/${client.deviceId}/revoke`,
      ).expect(204);

      const res = await asClient(`/documents/${docId}/content`, { grant });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('drops the grant on logout', async () => {
      const grant = await unlock(h, client);

      await signedRequest(h.server, {
        method: 'post',
        path: '/auth/logout',
        keys: client.keys,
        deviceId: client.deviceId,
        accessToken: client.accessToken,
      }).expect(204);

      expect(await h.prisma.documentGrant.count({ where: { revokedAt: null } })).toBe(0);
      void grant;
    });
  });

  describe('response contents', () => {
    it('never exposes storage keys, encryption material or paths', async () => {
      const detail = await asClient(`/documents/${docId}`).expect(200);
      const dumped = JSON.stringify(detail.body);

      expect(dumped).not.toMatch(/storageKey|storage_key/i);
      expect(dumped).not.toMatch(/encDek|enc_dek|searchText|search_text/i);
      expect(dumped).not.toMatch(/\/Users\/|\/var\/|\/tmp\//);

      // The exact shape, deliberately pinned: this test exists so that adding
      // a field to the serialiser is a decision someone has to make on
      // purpose, not something that slips out with a schema change.
      expect(Object.keys(detail.body).sort()).toEqual([
        'category',
        'documentDate',
        'fileType',
        'filename',
        'id',
        'isFavourite',
        'sizeBytes',
        'tags',
        'title',
        'updatedAt',
        'uploadedAt',
      ]);
    });

    it('records document reads in the audit trail without the title', async () => {
      const grant = await unlock(h, client);
      await asClient(`/documents/${docId}/content`, { grant }).expect(200);

      const events = await h.prisma.auditLog.findMany({
        where: { event: 'document.downloaded' },
      });
      expect(events).toHaveLength(1);
      expect(events[0].targetId).toBe(docId);
      expect(JSON.stringify(events[0].metadata)).not.toContain('MCA Degree');
    });
  });
});
