/**
 * Runs in every Jest worker before the test file is loaded.
 *
 * Points the app at the test database and a throwaway storage root, and drops
 * the Argon2 cost to the OWASP floor so a suite that hashes dozens of
 * passwords finishes in seconds. The production defaults are four times
 * heavier; nothing about the security properties under test depends on the
 * cost parameter.
 */
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { loadEnvFile } from '../src/config/load-env';

loadEnvFile();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://localhost:5432/vault_test';

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-storage-'));
process.env.STORAGE_ROOT = storageRoot;

process.env.ARGON2_MEMORY_KIB = '19456';
process.env.ARGON2_TIME_COST = '2';
process.env.ARGON2_PARALLELISM = '1';
