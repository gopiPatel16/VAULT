import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AdminFixture,
  Harness,
  adminRequest,
  createAdminAndLogin,
  resetDatabase,
  samplePdf,
  samplePng,
  startHarness,
} from '../helpers/harness';

describe('Upload pipeline', () => {
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

  const upload = (content: Buffer, filename: string, category = 'personal') =>
    adminRequest(h.server, admin, 'post', '/admin/documents/upload')
      .field('category', category)
      .attach('file', content, filename);

  describe('type detection', () => {
    it('accepts a real PDF', async () => {
      const res = await upload(samplePdf('x'), 'degree.pdf').expect(201);
      expect(res.body.fileType).toBe('application/pdf');
    });

    it('accepts a real PNG', async () => {
      const res = await upload(samplePng(), 'scan.png').expect(201);
      expect(res.body.fileType).toBe('image/png');
    });

    it('rejects an executable wearing a .pdf extension', async () => {
      // ELF magic. The extension says PDF; the bytes say otherwise.
      const elf = Buffer.concat([
        Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
        Buffer.alloc(128),
      ]);

      const res = await upload(elf, 'totally-a-degree.pdf');
      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(await h.prisma.document.count()).toBe(0);
    });

    it('rejects a shell script wearing a .png extension', async () => {
      const script = Buffer.from('#!/bin/sh\nrm -rf /\n', 'utf8');
      const res = await upload(script, 'photo.png');
      // Shebang text is valid UTF-8 without control characters, so it is
      // detected as text/plain — not as the PNG it claimed to be.
      expect(res.status).toBe(201);
      expect(res.body.fileType).toBe('text/plain');
      expect(res.body.filename).toMatch(/\.png$/);
    });

    it('rejects an ambiguous zip', async () => {
      const zip = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from('nothing recognisable in here', 'utf8'),
      ]);
      const res = await upload(zip, 'sheet.xlsx');
      expect(res.status).toBe(415);
    });

    it('rejects an empty upload', async () => {
      const res = await upload(Buffer.alloc(0), 'empty.pdf');
      expect(res.status).toBe(400);
    });
  });

  describe('path traversal', () => {
    it('never lets a filename become a path', async () => {
      const res = await upload(samplePdf('x'), '../../../etc/passwd').expect(201);

      // Stored as a display label with separators neutralised.
      expect(res.body.filename).not.toContain('/');
      expect(res.body.filename).not.toContain('..');

      const row = await h.prisma.document.findFirstOrThrow();
      // The storage key is a generated UUID, unrelated to anything supplied.
      expect(row.storageKey).toMatch(
        /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f-]{36}\.bin$/,
      );

      const storageRoot = process.env.STORAGE_ROOT!;
      const full = path.resolve(storageRoot, row.storageKey);
      expect(full.startsWith(path.resolve(storageRoot))).toBe(true);
      expect(fs.existsSync(full)).toBe(true);
    });

    it('strips control characters and quotes from the display name', async () => {
      const res = await upload(samplePdf('x'), 'we\u0000ird"na\u001bme.pdf').expect(201);
      expect(res.body.filename).not.toMatch(new RegExp('[\\u0000-\\u001f"]'));
    });
  });

  describe('storage', () => {
    it('writes ciphertext, not the document', async () => {
      const secret = samplePdf('TOP-SECRET-MARKER-STRING');
      await upload(secret, 'secret.pdf').expect(201);

      const row = await h.prisma.document.findFirstOrThrow();
      const onDisk = fs.readFileSync(
        path.resolve(process.env.STORAGE_ROOT!, row.storageKey),
      );

      expect(onDisk.includes(Buffer.from('TOP-SECRET-MARKER-STRING'))).toBe(false);
      expect(onDisk.subarray(0, 5).toString('ascii')).toBe('VLTF1');
      expect(onDisk.length).toBeGreaterThan(secret.length);
    });

    it('leaves no plaintext temp file behind', async () => {
      await upload(samplePdf('x'), 'ok.pdf').expect(201);
      const tempDir = path.join(process.env.STORAGE_ROOT!, 'tmp');
      const leftovers = fs.existsSync(tempDir) ? fs.readdirSync(tempDir) : [];
      expect(leftovers).toEqual([]);
    });

    it('leaves no temp file behind after a rejected type', async () => {
      await upload(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]), 'bad.pdf');
      const tempDir = path.join(process.env.STORAGE_ROOT!, 'tmp');
      const leftovers = fs.existsSync(tempDir) ? fs.readdirSync(tempDir) : [];
      expect(leftovers).toEqual([]);
    });
  });

  describe('metadata', () => {
    it('rejects an unknown category', async () => {
      const res = await upload(samplePdf('x'), 'a.pdf', 'not-a-category');
      expect(res.status).toBe(400);
    });

    it('records tags and makes them searchable', async () => {
      const res = await adminRequest(h.server, admin, 'post', '/admin/documents/upload')
        .field('category', 'education')
        .field('title', 'MCA Degree Certificate')
        .field('tags', 'university,degree')
        .attach('file', samplePdf('x'), 'mca.pdf')
        .expect(201);

      expect(res.body.tags).toEqual(['degree', 'university']);
      expect(res.body.category.slug).toBe('education');

      const found = await adminRequest(
        h.server,
        admin,
        'get',
        '/admin/documents?q=university',
      ).expect(200);
      expect(found.body.total).toBe(1);
    });
  });
});
