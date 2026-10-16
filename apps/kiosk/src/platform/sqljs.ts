/**
 * sql.js (SQLite compiled to WebAssembly) driver for the web app and the Android app.
 * The database runs in memory; every write marks it dirty and a snapshot is saved shortly after
 * (debounced). Code paths that must survive a power cut (payment journal) await flush(), which
 * resolves only once the snapshot holding those writes is stored. Snapshots replace each other
 * atomically, so storage always holds a consistent database.
 */
import type { Database, SqlJsStatic, Statement } from 'sql.js';
import type { SqlDatabase } from '../core/sql';

export interface SqlPersistence {
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;

function bind(st: Statement, params: unknown[]) {
  if (params.length === 0) return;
  if (params.length === 1 && isPlainObject(params[0])) {
    // better-sqlite3 style: { name: value } for `@name` placeholders.
    const named: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params[0])) named[/^[@$:]/.test(k) ? k : `@${k}`] = v ?? null;
    st.bind(named as never);
  } else {
    st.bind(params.map((v) => (v === undefined ? null : v)) as never);
  }
}

export async function openSqlJsDatabase(SQL: SqlJsStatic, persistence: SqlPersistence, opts: { debounceMs?: number } = {}): Promise<SqlDatabase> {
  const debounceMs = opts.debounceMs ?? 250;
  const db: Database = new SQL.Database((await persistence.load()) ?? undefined);
  let closed = false;
  let depth = 0;
  let version = 0; // bumped by every write
  let savedVersion = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let failures = 0;

  const save = (): Promise<void> => {
    const step = chain.then(async () => {
      if (closed || version === savedVersion) return;
      if (depth > 0) return void schedule(); // never snapshot half a transaction
      const v = version;
      try {
        await persistence.save(db.export());
      } catch (e) {
        // The data is still in memory: keep retrying with backoff (quota freed, storage back).
        failures++;
        schedule(Math.min(30_000, debounceMs * 2 ** failures));
        throw e;
      }
      failures = 0;
      savedVersion = Math.max(savedVersion, v);
    });
    // A failed save rejects only its own callers; later saves must still run.
    chain = step.catch(() => undefined);
    return step;
  };
  const schedule = (delay = debounceMs) => {
    if (timer || closed) return;
    timer = setTimeout(() => {
      timer = null;
      save().catch((e) => console.error('[kiosk] could not store the local database', e));
    }, delay);
  };
  const dirty = () => {
    version++;
    if (depth === 0) schedule();
  };
  const isRead = (sql: string) => /^\s*(SELECT|PRAGMA\s+\w+\s*$)/i.test(sql);

  // Statements are prepared per call: db.export() frees every prepared statement.
  const withStmt = <T>(sql: string, params: unknown[], fn: (st: Statement) => T): T => {
    const st = db.prepare(sql);
    try {
      bind(st, params);
      return fn(st);
    } finally {
      st.free();
    }
  };

  return {
    driver: 'sql.js',
    prepare(sql) {
      const write = !isRead(sql);
      return {
        run: (...p) => {
          const changes = withStmt(sql, p, (st) => {
            while (st.step()) {
              /* drain */
            }
            return db.getRowsModified();
          });
          if (write) dirty();
          return { changes };
        },
        get: (...p) => {
          const row = withStmt(sql, p, (st) => (st.step() ? st.getAsObject() : undefined));
          if (write) dirty();
          return row;
        },
        all: (...p) => {
          const rows = withStmt(sql, p, (st) => {
            const out: unknown[] = [];
            while (st.step()) out.push(st.getAsObject());
            return out;
          });
          if (write) dirty();
          return rows;
        },
      };
    },
    exec(sql) {
      db.exec(sql);
      if (!isRead(sql)) dirty();
    },
    transaction(fn) {
      return () => {
        const sp = depth === 0 ? null : `sp_${depth}`;
        db.exec(sp ? `SAVEPOINT ${sp}` : 'BEGIN');
        depth++;
        try {
          const out = fn();
          depth--;
          db.exec(sp ? `RELEASE ${sp}` : 'COMMIT');
          dirty();
          return out;
        } catch (e) {
          depth--;
          db.exec(sp ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK');
          throw e;
        }
      };
    },
    userVersion: () => Number(db.exec('PRAGMA user_version')[0]?.values[0]?.[0] ?? 0),
    setUserVersion(v) {
      db.run(`PRAGMA user_version = ${Math.trunc(v)}`);
      dirty();
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await save();
    },
    close() {
      if (closed) return;
      if (timer) clearTimeout(timer);
      const pending = version !== savedVersion ? db.export() : null;
      closed = true;
      db.close();
      if (pending) void persistence.save(pending).catch(() => undefined);
    },
  };
}

/** Persistence that only keeps snapshots in memory (tests). */
export function memoryPersistence(initial: Uint8Array | null = null): SqlPersistence & { saves: number; bytes: Uint8Array | null } {
  const p = {
    saves: 0,
    bytes: initial,
    load: async () => p.bytes,
    save: async (b: Uint8Array) => {
      p.bytes = b;
      p.saves++;
    },
  };
  return p;
}
