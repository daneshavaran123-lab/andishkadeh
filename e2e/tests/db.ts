import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * Direct access to the E2E test database for fixtures the UI cannot create (e.g. a subscription
 * whose period already ended). Uses the server's generated Prisma client.
 */
const serverRequire = createRequire(join(__dirname, '../../apps/server/package.json'));
const { PrismaClient } = serverRequire('@prisma/client') as { PrismaClient: new (o: { datasourceUrl: string }) => any };

export async function withDb<T>(fn: (db: any) => Promise<T>): Promise<T> {
  const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL! });
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
}
