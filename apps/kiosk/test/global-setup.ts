/**
 * Starts the real API server on the dedicated test database for kiosk-core integration tests.
 * Non-destructive: migrations are applied with `migrate deploy` and the seed is idempotent.
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

const serverDir = resolve(__dirname, '../../server');
export const TEST_PORT = 3101;
export const TEST_DEVICE_KEY = 'test-device-key-0123456789';
let child: ChildProcess | null = null;

function testDbUrl(): string {
  loadEnv({ path: resolve(serverDir, '.env') });
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL (apps/server/.env) or TEST_DATABASE_URL is required');
  if (process.env.TEST_DATABASE_URL) return base;
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/_test$/, '')}_test`;
  return url.toString();
}

export default async function setup() {
  const env = {
    ...process.env,
    DATABASE_URL: testDbUrl(),
    PORT: String(TEST_PORT),
    MEDIA_DIR: './storage/test-media',
    PUBLIC_BASE_URL: `http://localhost:${TEST_PORT}`,
    JWT_SECRET: process.env.JWT_SECRET ?? 'test-secret-0123456789abcdefghij',
    SEED_ADMIN_PASSWORD: 'Admin@12345',
    SEED_OPERATOR_PASSWORD: 'Operator@12345',
    SEED_DEVICE_ID: 'KIOSK-01',
    SEED_DEVICE_KEY: TEST_DEVICE_KEY,
  };
  execSync('npx prisma migrate deploy', { cwd: serverDir, env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed.ts', { cwd: serverDir, env, stdio: 'pipe' });
  // Always rebuild: a dist left over from an older checkout would test old server code.
  execSync('npx tsc -p tsconfig.build.json', { cwd: serverDir, stdio: 'pipe' });

  child = spawn(process.execPath, ['dist/main.js'], { cwd: serverDir, env, stdio: 'pipe' });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${TEST_PORT}/api/v1/health`);
      if (r.ok) return async () => void child?.kill();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error('test API server did not start');
}
