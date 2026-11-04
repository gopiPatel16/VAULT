import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Fail-fast configuration. If any secret is missing or the wrong length the
 * process refuses to start — a Vault that boots with a weak or absent key is
 * worse than one that does not boot at all.
 */

const base64Bytes = (min: number, exact?: number) =>
  z.string().refine(
    (v) => {
      let buf: Buffer;
      try {
        buf = Buffer.from(v, 'base64');
      } catch {
        return false;
      }
      if (exact !== undefined) return buf.length === exact;
      return buf.length >= min;
    },
    exact !== undefined
      ? `must be base64 encoding exactly ${exact} bytes`
      : `must be base64 encoding at least ${min} bytes`,
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: base64Bytes(32),
  SERVER_PEPPER: base64Bytes(32),
  STORAGE_KEK: base64Bytes(32, 32),
  IP_HASH_SALT: base64Bytes(16),

  STORAGE_ROOT: z.string().min(1),

  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(104857600),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SIGNATURE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  ARGON2_MEMORY_KIB: z.coerce.number().int().min(19456).default(65536),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(4),

  ADMIN_ORIGIN: z.string().default('http://localhost:5173'),
  ADMIN_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  ADMIN_STEPUP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
});

export type RawConfig = z.infer<typeof schema>;

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  host: string;
  port: number;
  databaseUrl: string;
  jwtSecret: Buffer;
  serverPepper: Buffer;
  storageKek: Buffer;
  ipHashSalt: Buffer;
  storageRoot: string;
  maxUploadBytes: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  signatureWindowSeconds: number;
  argon2: { memoryCost: number; timeCost: number; parallelism: number };
  adminOrigin: string;
  adminSessionTtlMinutes: number;
  adminStepUpTtlSeconds: number;
}

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;

  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Printed to the server console only, at startup, never over HTTP.
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  const c = parsed.data;

  // Guard against the classic self-inflicted wound: serving the blob store.
  const storageRoot = path.resolve(c.STORAGE_ROOT);
  fs.mkdirSync(storageRoot, { recursive: true, mode: 0o700 });

  cached = {
    nodeEnv: c.NODE_ENV,
    isProduction: c.NODE_ENV === 'production',
    host: c.HOST,
    port: c.PORT,
    databaseUrl: c.DATABASE_URL,
    jwtSecret: Buffer.from(c.JWT_SECRET, 'base64'),
    serverPepper: Buffer.from(c.SERVER_PEPPER, 'base64'),
    storageKek: Buffer.from(c.STORAGE_KEK, 'base64'),
    ipHashSalt: Buffer.from(c.IP_HASH_SALT, 'base64'),
    storageRoot,
    maxUploadBytes: c.MAX_UPLOAD_BYTES,
    accessTokenTtlSeconds: c.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlDays: c.REFRESH_TOKEN_TTL_DAYS,
    signatureWindowSeconds: c.SIGNATURE_WINDOW_SECONDS,
    argon2: {
      memoryCost: c.ARGON2_MEMORY_KIB,
      timeCost: c.ARGON2_TIME_COST,
      parallelism: c.ARGON2_PARALLELISM,
    },
    adminOrigin: c.ADMIN_ORIGIN,
    adminSessionTtlMinutes: c.ADMIN_SESSION_TTL_MINUTES,
    adminStepUpTtlSeconds: c.ADMIN_STEPUP_TTL_SECONDS,
  };

  return cached;
}

/** Test-only: drop the memoised config so a suite can re-load with new env. */
export function resetConfigCache(): void {
  cached = null;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
