/**
 * Prepares the dedicated test database (<db>_test) without destructive operations:
 * applies pending migrations and runs the idempotent seed. Tests are written to tolerate
 * data left by previous runs (unique mobiles/usernames, relative assertions), so the
 * database never needs to be reset. The development database is never touched.
 */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

export function testDatabaseUrl(): string {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL or TEST_DATABASE_URL is required for integration tests');
  if (process.env.TEST_DATABASE_URL) return base;
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/_test$/, '')}_test`;
  return url.toString();
}

export default async function setup() {
  const testUrl = testDatabaseUrl();
  const env = {
    ...process.env,
    DATABASE_URL: testUrl,
    MEDIA_DIR: './storage/test-media',
    SEED_ADMIN_USERNAME: 'admin',
    SEED_ADMIN_PASSWORD: 'Admin@12345',
    SEED_OPERATOR_USERNAME: 'operator',
    SEED_OPERATOR_PASSWORD: 'Operator@12345',
    SEED_DEVICE_ID: 'KIOSK-01',
    SEED_DEVICE_KEY: 'test-device-key-0123456789',
  };
  const cwd = resolve(__dirname, '..');
  execSync('npx prisma migrate deploy', { cwd, env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed.ts', { cwd, env, stdio: 'pipe' });
}
