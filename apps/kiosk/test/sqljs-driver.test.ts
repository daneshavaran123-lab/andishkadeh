/**
 * sql.js driver (web app / Android app): same semantics as better-sqlite3 for the calls the core
 * makes, plus persistence — flush() stores every committed write, and a reload sees exactly that.
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { kvGet, kvSet, migrate, nextCounter } from '../src/core/db';
import { memoryPersistence, openSqlJsDatabase } from '../src/platform/sqljs';

const SQL = await initSqlJs();

describe('sql.js driver', () => {
  it('migrates, binds positional and named parameters, and supports RETURNING', async () => {
    const db = migrate(await openSqlJsDatabase(SQL, memoryPersistence()));
    expect(db.userVersion()).toBe(1);
    kvSet(db, 'a', { x: 1 });
    expect(kvGet(db, 'a')).toEqual({ x: 1 });
    expect(nextCounter(db, 'off')).toBe(1);
    expect(nextCounter(db, 'off')).toBe(2);
    db.prepare('INSERT INTO counters (name, value) VALUES (@name, @value)').run({ name: 'n', value: 7 });
    expect(db.prepare('SELECT value FROM counters WHERE name = ?').get('n')).toEqual({ value: 7 });
    expect(db.prepare('SELECT * FROM counters WHERE name = ?').get('missing')).toBeUndefined();
    expect(db.prepare("UPDATE counters SET value = value + 1 WHERE name IN ('n', 'off')").run().changes).toBe(2);
    expect(db.prepare('SELECT name FROM counters ORDER BY name').all()).toEqual([{ name: 'n' }, { name: 'off' }]);
    db.close();
  });

  it('rolls back failed transactions, including nested ones', async () => {
    const db = migrate(await openSqlJsDatabase(SQL, memoryPersistence()));
    const ins = db.prepare('INSERT INTO counters (name, value) VALUES (?, ?)');
    expect(() =>
      db.transaction(() => {
        ins.run('a', 1);
        throw new Error('boom');
      })(),
    ).toThrow('boom');
    db.transaction(() => {
      ins.run('b', 1);
      try {
        db.transaction(() => {
          ins.run('c', 1);
          throw new Error('inner');
        })();
      } catch {
        /* inner savepoint rolled back only */
      }
    })();
    expect(db.prepare('SELECT name FROM counters ORDER BY name').all()).toEqual([{ name: 'b' }]);
    db.close();
  });

  it('flush() stores committed writes; a reload (power cut) sees them', async () => {
    const store = memoryPersistence();
    const db = migrate(await openSqlJsDatabase(SQL, store, { debounceMs: 60_000 }));
    db.prepare("INSERT INTO payment_journal (attempt_id, local_order_id, amount, state, started_at) VALUES (?, ?, ?, 'IN_FLIGHT', ?)").run(
      'att-1',
      'ord-1',
      1000,
      new Date().toISOString(),
    );
    // Not stored yet (long debounce) → a crash here would lose the row; the core awaits flush() first.
    expect(store.saves).toBe(0);
    await db.flush();
    const saves = store.saves;
    await db.flush(); // nothing new → no extra snapshot
    expect(store.saves).toBe(saves);

    const reloaded = migrate(await openSqlJsDatabase(SQL, memoryPersistence(store.bytes)));
    expect(reloaded.prepare('SELECT state FROM payment_journal WHERE attempt_id = ?').get('att-1')).toEqual({ state: 'IN_FLIGHT' });
    db.close();
    reloaded.close();
  });

  it('saves automatically after writes (debounced)', async () => {
    const store = memoryPersistence();
    const db = migrate(await openSqlJsDatabase(SQL, store, { debounceMs: 10 }));
    kvSet(db, 'k', 'v');
    await new Promise((r) => setTimeout(r, 80));
    const reloaded = await openSqlJsDatabase(SQL, memoryPersistence(store.bytes));
    expect(kvGet(reloaded, 'k')).toBe('v');
    db.close();
  });

  it('a failed save does not stop later saves, and retries on its own', async () => {
    const store = memoryPersistence();
    let failNext = 1;
    const flaky = {
      load: store.load,
      save: async (b: Uint8Array) => {
        if (failNext-- > 0) throw new Error('QuotaExceededError');
        await store.save(b);
      },
    };
    const db = migrate(await openSqlJsDatabase(SQL, flaky, { debounceMs: 60_000 }));
    kvSet(db, 'k', 'first');
    await expect(db.flush()).rejects.toThrow('QuotaExceededError');
    kvSet(db, 'k', 'second');
    await db.flush(); // storage is back: this save must run, not inherit the earlier rejection
    expect(kvGet(await openSqlJsDatabase(SQL, memoryPersistence(store.bytes)), 'k')).toBe('second');
    db.close();

    // Without an explicit flush, the driver retries the failed save in the background.
    const store2 = memoryPersistence();
    let fails = 1;
    const db2 = migrate(
      await openSqlJsDatabase(
        SQL,
        {
          load: store2.load,
          save: async (b) => {
            if (fails-- > 0) throw new Error('IDB unavailable');
            await store2.save(b);
          },
        },
        { debounceMs: 5 },
      ),
    );
    const errors = console.error;
    console.error = () => undefined;
    try {
      kvSet(db2, 'k', 'v');
      await new Promise((r) => setTimeout(r, 120));
    } finally {
      console.error = errors;
    }
    expect(kvGet(await openSqlJsDatabase(SQL, memoryPersistence(store2.bytes)), 'k')).toBe('v');
    db2.close();
  });
});
