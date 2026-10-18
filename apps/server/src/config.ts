import 'dotenv/config';
import { resolve } from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // 3001: port 3000 is often taken on Windows (EonVPN and other local services).
  PORT: z.coerce.number().int().default(3001),
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: z.coerce.number().int().default(0),
  JWT_SECRET: z.string().min(24, 'JWT_SECRET must be at least 24 characters'),
  ADMIN_SESSION_HOURS: z.coerce.number().positive().default(8),
  /** Admin sessions opened from a kiosk (gear on the welcome screen) are short: a public device. */
  KIOSK_ADMIN_SESSION_MINUTES: z.coerce.number().positive().default(30),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  MEDIA_DIR: z.string().default('./storage/media'),
  MEDIA_MAX_MB: z.coerce.number().positive().default(8),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3001'),
  /** Optional: built admin panel (apps/admin/dist) served at /admin from the same origin. */
  ADMIN_DIST_DIR: z.string().default(''),
  /** Optional: built customer web app (apps/kiosk/dist-web) served at the site root `/`. */
  WEB_APP_DIST_DIR: z.string().default(''),
  /** Former name of WEB_APP_DIST_DIR (the web app used to live under /kiosk/). */
  KIOSK_WEB_DIST_DIR: z.string().default(''),
  /** Optional: where the panel links the Windows kiosk installer (default: this release on GitHub). */
  KIOSK_INSTALLER_URL: z.string().default(''),
  NODE_ENV: z.string().default('development'),
});

/** Browser origins of the development UIs (admin :5173, kiosk :5174, kiosk web app :5176). */
const DEV_ORIGINS = [5173, 5174, 5176].flatMap((port) => [`http://localhost:${port}`, `http://127.0.0.1:${port}`]);

export type AppConfig = z.infer<typeof EnvSchema> & {
  mediaDirAbs: string;
  adminDistAbs: string | null;
  webAppDistAbs: string | null;
  corsOrigins: string[];
};

let cached: AppConfig | null = null;

/** Settings that are fine on a developer machine but must never reach production (NODE_ENV=production). */
export function productionProblems(env: z.infer<typeof EnvSchema>): string[] {
  const problems: string[] = [];
  if (/CHANGE_ME/i.test(env.JWT_SECRET) || env.JWT_SECRET.length < 32) problems.push('JWT_SECRET: set a random value of at least 32 characters');
  if (/CHANGE_ME/i.test(env.DATABASE_URL)) problems.push('DATABASE_URL: still the example value');
  if (!/^https:\/\//.test(env.PUBLIC_BASE_URL)) problems.push('PUBLIC_BASE_URL: must be the public https:// address of this server');
  return problems;
}

export function config(): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    const problems = productionProblems(parsed.data);
    if (problems.length) throw new Error(`Refusing to start in production: ${problems.join('; ')}`);
  }
  cached = {
    ...parsed.data,
    mediaDirAbs: resolve(process.cwd(), parsed.data.MEDIA_DIR),
    adminDistAbs: parsed.data.ADMIN_DIST_DIR ? resolve(process.cwd(), parsed.data.ADMIN_DIST_DIR) : null,
    webAppDistAbs: absOrNull(parsed.data.WEB_APP_DIST_DIR || parsed.data.KIOSK_WEB_DIST_DIR),
    corsOrigins: corsOrigins(parsed.data),
  };
  return cached;
}

/**
 * Browser origins allowed to call the API. Same-origin pages (/, /admin, /kiosk) and the Windows
 * kiosk (requests from its main process) need none. Without CORS_ORIGINS, development allows the
 * local dev UIs and production allows nothing.
 */
function corsOrigins(env: z.infer<typeof EnvSchema>): string[] {
  const list = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length || env.NODE_ENV === 'production') return list;
  return DEV_ORIGINS;
}

const absOrNull = (dir: string) => (dir ? resolve(process.cwd(), dir) : null);

/** Test helper: forget cached config after mutating process.env. */
export function resetConfigCache() {
  cached = null;
}
