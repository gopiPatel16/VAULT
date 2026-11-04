import 'reflect-metadata';
import * as crypto from 'node:crypto';
import request from 'supertest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { authenticator } from 'otplib';
import { createApp, API_PREFIX } from '../../src/bootstrap';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { PasswordService } from '../../src/common/crypto/password.service';
import { EnvelopeCryptoService } from '../../src/common/crypto/envelope.service';
import { RateLimiterService } from '../../src/common/services/rate-limiter.service';
import { TOTP_AAD } from '../../src/modules/admin/admin-auth.service';
import { toDbBytes } from '../../src/common/crypto/bytes';
import { resetConfigCache } from '../../src/config/configuration';

export const PREFIX = `/${API_PREFIX}`;

export interface Harness {
  app: NestFastifyApplication;
  server: unknown;
  prisma: PrismaService;
  passwords: PasswordService;
  envelope: EnvelopeCryptoService;
  limiter: RateLimiterService;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  resetConfigCache();
  const app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    server: app.getHttpServer(),
    prisma: app.get(PrismaService),
    passwords: app.get(PasswordService),
    envelope: app.get(EnvelopeCryptoService),
    limiter: app.get(RateLimiterService),
    close: () => app.close(),
  };
}

/**
 * Wipes every table except the fixed category vocabulary, and returns
 * `vault_secret` to its unconfigured state so each suite starts from a vault
 * with no master password set.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_log, dmp_attempts, document_grants, sessions, enrollment_codes,
      devices, favorites, client_document_access, client_category_access,
      document_tags, tags, documents, clients, admin_sessions, admins
    RESTART IDENTITY CASCADE
  `);
  // `vault_secret.updated_by` references `admins`, so the CASCADE above takes
  // the singleton row with it. Re-create rather than update.
  await prisma.$executeRawUnsafe(`
    INSERT INTO vault_secret (id, dmp_version, grant_ttl_seconds)
    VALUES (1, 0, 300)
    ON CONFLICT (id) DO UPDATE
      SET dmp_hash = NULL, dmp_version = 0, grant_ttl_seconds = 300,
          configured_at = NULL, updated_at = NULL, updated_by = NULL
  `);
}

// ── Device identity ─────────────────────────────────────────────────────────

export interface DeviceKeys {
  privateKey: crypto.KeyObject;
  publicKeyB64: string;
}

export function generateDeviceKeys(): DeviceKeys {
  // P-256, matching what Secure Enclave and Android StrongBox can hold.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return { privateKey, publicKeyB64: spki.toString('base64') };
}

/**
 * Produces the same canonical string the server rebuilds in
 * `SignatureService.verify`. If these two ever drift apart every client
 * request fails, which is a loud failure rather than a quiet one.
 */
export function signHeaders(
  keys: DeviceKeys,
  deviceId: string,
  method: string,
  url: string,
  body: string,
): Record<string, string> {
  const timestamp = Date.now();
  const nonce = crypto.randomBytes(12).toString('base64url');
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const message = ['v1', method.toUpperCase(), url, String(timestamp), nonce, bodyHash].join('\n');
  const signature = crypto.sign('sha256', Buffer.from(message, 'utf8'), keys.privateKey);

  return {
    'x-device-id': deviceId,
    'x-timestamp': String(timestamp),
    'x-nonce': nonce,
    'x-signature': signature.toString('base64'),
  };
}

export interface SignedRequestOptions {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  keys: DeviceKeys;
  deviceId: string;
  body?: unknown;
  accessToken?: string;
  grant?: string;
  /** Override the signature headers, for negative tests. */
  headerOverrides?: Record<string, string>;
}

/** Issues a fully signed client request against the running app. */
export function signedRequest(
  server: unknown,
  opts: SignedRequestOptions,
): request.Test {
  const url = `${PREFIX}${opts.path}`;
  const bodyString = opts.body === undefined ? '' : JSON.stringify(opts.body);

  const headers: Record<string, string> = {
    ...signHeaders(opts.keys, opts.deviceId, opts.method, url, bodyString),
    ...(opts.accessToken ? { authorization: `Bearer ${opts.accessToken}` } : {}),
    ...(opts.grant ? { 'x-vault-grant': opts.grant } : {}),
    ...(opts.headerOverrides ?? {}),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let req = (request(server as any) as any)[opts.method](url);
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);

  if (opts.body !== undefined) {
    // The exact bytes are sent, because the signature covers their hash. Letting
    // supertest re-serialise the object would change key order and break it.
    req = req.set('Content-Type', 'application/json').send(bodyString);
  }
  return req as request.Test;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

export const ADMIN_PASSWORD = 'correct-horse-battery-staple-99';
export const CLIENT_PASSWORD = 'client-password-of-adequate-length';
export const MASTER_PASSWORD = 'Sunlit-Harbour-Ledger-77';

export interface AdminFixture {
  id: string;
  username: string;
  password: string;
  totpSecret: string;
  token: string;
  totp(): string;
}

export async function createAdminAndLogin(h: Harness): Promise<AdminFixture> {
  const totpSecret = authenticator.generateSecret(32);
  const username = `admin${crypto.randomBytes(4).toString('hex')}`;

  const admin = await h.prisma.admin.create({
    data: {
      username,
      passwordHash: await h.passwords.hash(ADMIN_PASSWORD),
      totpSecretEnc: toDbBytes(
        h.envelope.encryptSecret(Buffer.from(totpSecret, 'utf8'), TOTP_AAD),
      ),
      totpEnabled: true,
      recoveryCodeHashes: [],
    },
  });

  const totp = (): string => authenticator.generate(totpSecret);

  const res = await request(h.server as never)
    .post(`${PREFIX}/admin/auth/login`)
    .send({ username, password: ADMIN_PASSWORD, totp: totp() })
    .expect(200);

  return {
    id: admin.id,
    username,
    password: ADMIN_PASSWORD,
    totpSecret,
    token: res.body.data?.token ?? res.body.token,
    totp,
  };
}

export function adminRequest(
  server: unknown,
  admin: AdminFixture,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
): request.Test {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (request(server as any) as any)
    [method](`${PREFIX}${path}`)
    .set('authorization', `Bearer ${admin.token}`) as request.Test;
}

export interface ClientFixture {
  clientId: string;
  loginId: string;
  deviceId: string;
  keys: DeviceKeys;
  accessToken: string;
  refreshToken: string;
}

/**
 * Walks the real enrolment and login flow rather than inserting rows: if the
 * flow breaks, every suite that depends on it fails, which is what we want.
 */
export async function enrollClient(
  h: Harness,
  admin: AdminFixture,
  opts: { displayName?: string; categorySlugs?: string[] } = {},
): Promise<ClientFixture> {
  const loginId = `client${crypto.randomBytes(4).toString('hex')}`;

  const created = await adminRequest(h.server, admin, 'post', '/admin/clients')
    .send({
      displayName: opts.displayName ?? 'Test Client',
      loginId,
      password: CLIENT_PASSWORD,
    })
    .expect(201);
  const clientId: string = created.body.id;

  if (opts.categorySlugs?.length) {
    await adminRequest(h.server, admin, 'put', `/admin/clients/${clientId}/access`)
      .send({ categorySlugs: opts.categorySlugs })
      .expect(200);
  }

  const codeRes = await adminRequest(
    h.server,
    admin,
    'post',
    `/admin/clients/${clientId}/enrollment-code`,
  ).expect(200);

  const keys = generateDeviceKeys();
  const placeholderDeviceId = crypto.randomUUID();

  const enrolled = await signedRequest(h.server, {
    method: 'post',
    path: '/auth/enroll',
    keys,
    deviceId: placeholderDeviceId,
    body: {
      code: codeRes.body.code,
      publicKey: keys.publicKeyB64,
      deviceName: 'Test Device',
      platform: 'ios',
    },
  }).expect(200);

  const deviceId: string = enrolled.body.deviceId;

  const login = await signedRequest(h.server, {
    method: 'post',
    path: '/auth/login',
    keys,
    deviceId,
    body: { loginId, password: CLIENT_PASSWORD },
  }).expect(200);

  return {
    clientId,
    loginId,
    deviceId,
    keys,
    accessToken: login.body.accessToken,
    refreshToken: login.body.refreshToken,
  };
}

/** Sets the Document Master Password through the administrator surface. */
export async function setMasterPassword(
  h: Harness,
  admin: AdminFixture,
  password = MASTER_PASSWORD,
): Promise<void> {
  await adminRequest(h.server, admin, 'post', '/admin/security/master-password')
    .send({ password })
    .expect(204);
}

/** Unlocks and returns a live document grant for the given client. */
export async function unlock(
  h: Harness,
  client: ClientFixture,
  password = MASTER_PASSWORD,
): Promise<string> {
  const res = await signedRequest(h.server, {
    method: 'post',
    path: '/vault/unlock',
    keys: client.keys,
    deviceId: client.deviceId,
    accessToken: client.accessToken,
    body: { password },
  }).expect(200);
  return res.body.grant;
}

/** Uploads a document as the administrator and returns its id. */
export async function uploadDocument(
  h: Harness,
  admin: AdminFixture,
  opts: {
    filename?: string;
    content?: Buffer;
    category?: string;
    title?: string;
    tags?: string;
  } = {},
): Promise<{ id: string; body: Record<string, unknown> }> {
  const content = opts.content ?? samplePdf('hello vault');

  let req = adminRequest(h.server, admin, 'post', '/admin/documents/upload')
    .field('category', opts.category ?? 'personal');

  if (opts.title) req = req.field('title', opts.title);
  if (opts.tags) req = req.field('tags', opts.tags);

  const res = await req.attach('file', content, opts.filename ?? 'sample.pdf');
  if (res.status !== 201) {
    throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { id: res.body.id, body: res.body };
}

/** A byte sequence that passes the PDF magic-byte check. */
export function samplePdf(payload: string): Buffer {
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n', 'ascii'),
    Buffer.from(payload, 'utf8'),
    Buffer.from('\n%%EOF\n', 'ascii'),
  ]);
}

export function samplePng(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    crypto.randomBytes(64),
  ]);
}

/** JSON.stringify that survives BigInt ids, for leakage scans over DB rows. */
export function dump(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}
