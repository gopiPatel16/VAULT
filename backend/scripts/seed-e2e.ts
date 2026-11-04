/**
 * Seeds a disposable vault for the end-to-end test, then writes the details
 * the Flutter client needs to connect to it.
 *
 *   npx ts-node -T scripts/seed-e2e.ts
 *
 * Everything after the administrator row is done over the real HTTP admin API
 * rather than by writing rows directly. That is the point: if an admin
 * endpoint is broken, seeding fails, and the end-to-end run does not get to
 * pretend the system works by reaching around it.
 *
 * Not for production. It creates a known-password administrator.
 */
import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { authenticator } from 'otplib';
import { loadEnvFile } from '../src/config/load-env';
import { loadConfig } from '../src/config/configuration';
import { PasswordService } from '../src/common/crypto/password.service';
import { EnvelopeCryptoService } from '../src/common/crypto/envelope.service';
import { TOTP_AAD } from '../src/modules/admin/admin-auth.service';
import { toDbBytes } from '../src/common/crypto/bytes';

loadEnvFile();

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';
const API = `${BASE_URL}/api/v1`;

const ADMIN_USERNAME = 'e2e-admin';
const ADMIN_PASSWORD = 'e2e-administrator-password-1234';
const CLIENT_LOGIN = 'e2e-client';
const CLIENT_PASSWORD = 'e2e-client-password-5678';
const MASTER_PASSWORD = 'E2E-Master-Passphrase-9012';
const DOCUMENT_BODY = 'END-TO-END DOCUMENT CONTENTS — must arrive byte-identical';

async function api(
  method: string,
  route: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (response.status >= 400) {
    throw new Error(`${method} ${route} → ${response.status} ${text}`);
  }
  return { status: response.status, json };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = new PrismaClient();
  const passwords = new PasswordService(config);
  const envelope = new EnvelopeCryptoService(config);

  try {
    // ── Clean slate ───────────────────────────────────────────────────────
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        audit_log, dmp_attempts, document_grants, sessions, enrollment_codes,
        devices, favorites, client_document_access, client_category_access,
        document_tags, tags, documents, clients, admin_sessions, admins
      RESTART IDENTITY CASCADE
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO vault_secret (id, dmp_version, grant_ttl_seconds)
      VALUES (1, 0, 300)
      ON CONFLICT (id) DO UPDATE
        SET dmp_hash = NULL, dmp_version = 0, grant_ttl_seconds = 300,
            configured_at = NULL, updated_at = NULL, updated_by = NULL
    `);

    // ── The one thing that cannot go through the API ──────────────────────
    // Creating the first administrator is a local operation by design.
    const totpSecret = authenticator.generateSecret(32);
    await prisma.admin.create({
      data: {
        username: ADMIN_USERNAME,
        passwordHash: await passwords.hash(ADMIN_PASSWORD),
        totpSecretEnc: toDbBytes(
          envelope.encryptSecret(Buffer.from(totpSecret, 'utf8'), TOTP_AAD),
        ),
        totpEnabled: true,
        recoveryCodeHashes: [],
      },
    });

    // ── Everything else over the real admin API ───────────────────────────
    const login = await api('POST', '/admin/auth/login', null, {
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
      totp: authenticator.generate(totpSecret),
    });
    const adminToken = login.json.token as string;

    await api('POST', '/admin/security/master-password', adminToken, {
      password: MASTER_PASSWORD,
    });

    const client = await api('POST', '/admin/clients', adminToken, {
      displayName: 'End-to-end Client',
      loginId: CLIENT_LOGIN,
      password: CLIENT_PASSWORD,
    });
    const clientId = client.json.id as string;

    await api('PUT', `/admin/clients/${clientId}/access`, adminToken, {
      categorySlugs: ['personal'],
    });

    // Upload through the real multipart endpoint, so the document the client
    // downloads went through the real ingestion pipeline: magic-byte sniffing,
    // per-file key, encryption, the lot.
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.7\n', 'ascii'),
      Buffer.from(DOCUMENT_BODY, 'utf8'),
      Buffer.from('\n%%EOF\n', 'ascii'),
    ]);

    const form = new FormData();
    form.append('category', 'personal');
    form.append('title', 'MCA Degree');
    form.append('tags', 'university,degree');
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'mca.pdf');

    const uploadResponse = await fetch(`${API}/admin/documents/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: form,
    });
    const uploadText = await uploadResponse.text();
    if (uploadResponse.status !== 201) {
      throw new Error(`upload → ${uploadResponse.status} ${uploadText}`);
    }
    const document = JSON.parse(uploadText) as Record<string, unknown>;

    const code = await api(
      'POST',
      `/admin/clients/${clientId}/enrollment-code`,
      adminToken,
    );

    const fixture = {
      baseUrl: BASE_URL,
      // Included so the administrator console can be driven in development.
      // This fixture is gitignored and describes a throwaway vault only.
      adminUsername: ADMIN_USERNAME,
      adminPassword: ADMIN_PASSWORD,
      adminTotpSecret: totpSecret,
      enrollmentCode: code.json.code as string,
      loginId: CLIENT_LOGIN,
      clientPassword: CLIENT_PASSWORD,
      masterPassword: MASTER_PASSWORD,
      documentId: document.id as string,
      documentTitle: document.title as string,
      expectedContentBase64: pdf.toString('base64'),
      expectedSizeBytes: pdf.length,
    };

    const out = path.join(
      __dirname,
      '..',
      '..',
      'client-app',
      'test',
      'fixtures',
      'e2e.json',
    );
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, JSON.stringify(fixture, null, 2));

    process.stdout.write(
      `Seeded. Document ${fixture.documentId}, fixture written to\n  ${out}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\nseed failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
