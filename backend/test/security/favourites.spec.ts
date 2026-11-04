import {
  AdminFixture,
  ClientFixture,
  Harness,
  adminRequest,
  createAdminAndLogin,
  enrollClient,
  resetDatabase,
  setMasterPassword,
  signedRequest,
  startHarness,
  uploadDocument,
} from '../helpers/harness';

/**
 * Favourites are metadata, and metadata is Layer 1.
 *
 * Two properties matter here beyond "it works": a favourite must never be
 * visible to another client, and marking one must not require — or grant —
 * any document access. It is a bookmark, not a door.
 */
describe('Favourites', () => {
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

  const as = (
    method: 'get' | 'post' | 'delete',
    path: string,
    c: ClientFixture = client,
  ) =>
    signedRequest(h.server, {
      method,
      path,
      keys: c.keys,
      deviceId: c.deviceId,
      accessToken: c.accessToken,
    });

  it('reports documents as not favourited to begin with', async () => {
    const list = await as('get', '/documents').expect(200);
    expect(list.body.items[0].isFavourite).toBe(false);

    const detail = await as('get', `/documents/${docId}`).expect(200);
    expect(detail.body.isFavourite).toBe(false);
  });

  it('marks and unmarks, and both list and detail agree', async () => {
    await as('post', `/documents/${docId}/favorite`).expect(204);

    expect((await as('get', '/documents').expect(200)).body.items[0].isFavourite).toBe(true);
    expect((await as('get', `/documents/${docId}`).expect(200)).body.isFavourite).toBe(true);

    await as('delete', `/documents/${docId}/favorite`).expect(204);

    expect((await as('get', '/documents').expect(200)).body.items[0].isFavourite).toBe(false);
  });

  it('filters to favourites only when asked', async () => {
    await uploadDocument(h, admin, { title: 'PAN Card' });

    expect((await as('get', '/documents').expect(200)).body.total).toBe(2);
    expect((await as('get', '/documents?favorites=true').expect(200)).body.total).toBe(0);

    await as('post', `/documents/${docId}/favorite`).expect(204);

    const filtered = await as('get', '/documents?favorites=true').expect(200);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items[0].title).toBe('MCA Degree');
  });

  it("never shows one client's favourite to another", async () => {
    const other = await enrollClient(h, admin, { categorySlugs: ['personal'] });

    await as('post', `/documents/${docId}/favorite`).expect(204);

    // Same document, different client: theirs is untouched.
    const theirs = await as('get', '/documents', other).expect(200);
    expect(theirs.body.items[0].isFavourite).toBe(false);
    expect((await as('get', '/documents?favorites=true', other).expect(200)).body.total).toBe(0);

    // And the marking client still sees their own.
    expect((await as('get', '/documents').expect(200)).body.items[0].isFavourite).toBe(true);
  });

  it('refuses to favourite a document the client may not have', async () => {
    const outsider = await enrollClient(h, admin, { categorySlugs: ['finance'] });

    const res = await as('post', `/documents/${docId}/favorite`, outsider);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    expect(await h.prisma.favorite.count()).toBe(0);
  });

  it('needs no document grant — a bookmark is not a door', async () => {
    // No unlock has happened, and none is performed here.
    await as('post', `/documents/${docId}/favorite`).expect(204);

    // Marking it did not hand out document access.
    const content = await as('get', `/documents/${docId}/content`);
    expect(content.status).toBe(401);
    expect(content.body.error.code).toBe('GRANT_REQUIRED');
  });

  it('does not leak favourite state through the administrator listing', async () => {
    await as('post', `/documents/${docId}/favorite`).expect(204);

    const adminList = await adminRequest(h.server, admin, 'get', '/admin/documents').expect(200);

    // "Whose favourite" has no meaning on the administrator surface.
    expect(adminList.body.items[0].isFavourite).toBe(false);
  });
});
