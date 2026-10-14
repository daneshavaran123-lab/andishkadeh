// E2E API: dedicated test database, non-destructive migrate + idempotent seed, then start the server.
import { execSync, spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const serverDir = resolve(root, 'apps/server');
// Resolved once in playwright.config.ts (TEST_DATABASE_URL or DATABASE_URL + "_test").
const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) throw new Error('E2E_DATABASE_URL missing — start through playwright.config.ts');

const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  PORT: '3200',
  PUBLIC_BASE_URL: 'http://localhost:3200',
  CORS_ORIGINS: 'http://localhost:5283,http://localhost:5284',
  MEDIA_DIR: './storage/test-media',
  JWT_SECRET: process.env.JWT_SECRET ?? 'e2e-secret-0123456789abcdefghijkl',
  SEED_ADMIN_PASSWORD: 'Admin@12345',
  SEED_OPERATOR_PASSWORD: 'Operator@12345',
  SEED_DEVICE_ID: 'KIOSK-01',
  SEED_DEVICE_KEY: 'test-device-key-0123456789',
};
execSync('npx prisma migrate deploy', { cwd: serverDir, env, stdio: 'inherit' });
execSync('npx tsx prisma/seed.ts', { cwd: serverDir, env, stdio: 'inherit' });
execSync('npx tsc -p tsconfig.build.json', { cwd: serverDir, env, stdio: 'inherit' });
const child = spawn(process.execPath, ['dist/main.js'], { cwd: serverDir, env, stdio: 'inherit' });
process.on('SIGTERM', () => child.kill());
process.on('SIGINT', () => child.kill());
child.on('exit', (code) => process.exit(code ?? 0));
