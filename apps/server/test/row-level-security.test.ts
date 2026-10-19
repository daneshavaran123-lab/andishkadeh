/**
 * Row-level security: on for every table, the server's own user (the tables' owner) unrestricted,
 * and no policy for any other role, so another database user sees no rows even with SELECT granted.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestEnv } from './helpers';

let prisma: PrismaClient;

beforeAll(() => {
  useTestEnv();
  prisma = new PrismaClient();
});

afterAll(() => prisma?.$disconnect());

describe('row-level security', () => {
  it('is on for every table, not forced on the owner, with no policy for other roles', async () => {
    const tables = await prisma.$queryRaw<Array<{ name: string; rls: boolean; forced: boolean; owned: boolean }>>`
      SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced, pg_get_userbyid(c.relowner) = current_user AS owned
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')`;
    expect(tables.length).toBeGreaterThan(15);
    // a table added later without "ENABLE ROW LEVEL SECURITY" in its migration shows up here
    expect(tables.filter((t) => !t.rls).map((t) => t.name)).toEqual([]);
    expect(tables.filter((t) => t.forced).map((t) => t.name)).toEqual([]);
    expect(tables.every((t) => t.owned)).toBe(true);
    const [{ policies }] = await prisma.$queryRaw<Array<{ policies: bigint }>>`SELECT count(*) AS policies FROM pg_policies WHERE schemaname = current_schema()`;
    expect(Number(policies)).toBe(0);
  });

  it('another database role granted SELECT sees no rows; the server still sees them all', async (ctx) => {
    const [me] = await prisma.$queryRaw<Array<{ can: boolean }>>`SELECT rolsuper OR rolcreaterole AS can FROM pg_roles WHERE rolname = current_user`;
    if (!me.can) ctx.skip(); // needs a user that may create roles (as in CI)
    const role = `rls_probe_${randomBytes(4).toString('hex')}`;
    await prisma.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
    try {
      await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${await schema()}" TO ${role}`);
      await prisma.$executeRawUnsafe(`GRANT SELECT ON "Service", "Customer", "Order" TO ${role}`);
      const counts = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        return tx.$queryRaw<Array<{ services: bigint; customers: bigint; orders: bigint }>>`
          SELECT (SELECT count(*) FROM "Service") AS services, (SELECT count(*) FROM "Customer") AS customers, (SELECT count(*) FROM "Order") AS orders`;
      });
      expect(counts[0]).toEqual({ services: 0n, customers: 0n, orders: 0n });
      expect(await prisma.service.count()).toBeGreaterThan(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP OWNED BY ${role}`);
      await prisma.$executeRawUnsafe(`DROP ROLE ${role}`);
    }
  });
});

async function schema() {
  const [{ s }] = await prisma.$queryRaw<Array<{ s: string }>>`SELECT current_schema() AS s`;
  return s;
}
