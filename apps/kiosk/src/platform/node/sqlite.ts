/**
 * better-sqlite3 driver (Electron main process, dev bridge, tests).
 * WAL + synchronous=FULL: a committed journal row survives a power loss, so flush() has nothing to wait for.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SqlDatabase } from '../../core/sql';

export function openNodeDatabase(file: string): SqlDatabase {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  // KIOSK_SQLITE_BINDING lets technicians point to a specific native build (troubleshooting only).
  const nativeBinding = process.env.KIOSK_SQLITE_BINDING;
  const db = new Database(file, nativeBinding ? { nativeBinding } : {});
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  return {
    driver: 'better-sqlite3',
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        run: (...p) => ({ changes: stmt.run(...p).changes }),
        get: (...p) => stmt.get(...p),
        all: (...p) => stmt.all(...p),
      };
    },
    exec: (sql) => void db.exec(sql),
    transaction: (fn) => db.transaction(fn),
    userVersion: () => db.pragma('user_version', { simple: true }) as number,
    setUserVersion: (v) => void db.pragma(`user_version = ${Math.trunc(v)}`),
    flush: async () => undefined,
    close: () => db.close(),
  };
}
