import * as path from 'node:path';

/**
 * Loads `.env` for local development and for the maintenance CLIs.
 *
 * In production the process should receive real environment variables from the
 * service manager; a missing `.env` is therefore not an error. What IS an error
 * — enforced by `loadConfig()` — is a missing or malformed secret, whatever its
 * source.
 */
export function loadEnvFile(file = '.env'): void {
  const loader = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (!loader) return;
  try {
    loader.call(process, path.resolve(process.cwd(), file));
  } catch {
    // No .env present. Real environment variables are expected instead.
  }
}
