import { execSync } from 'node:child_process';
import { loadEnvFile } from '../src/config/load-env';

/**
 * Applies migrations to the test database once, before any worker starts.
 * The same migration files that run in production, against a real Postgres —
 * a suite run against a mocked data layer would prove nothing about the
 * constraints that enforce half the security model.
 */
export default function globalSetup(): void {
  loadEnvFile();

  const url =
    process.env.TEST_DATABASE_URL ?? 'postgresql://localhost:5432/vault_test';

  execSync('npx prisma migrate deploy', {
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: url },
  });
}
