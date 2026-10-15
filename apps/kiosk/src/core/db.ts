/**
 * Local SQLite store of the kiosk (PRD §15): last good catalogue snapshot, local orders,
 * the payment journal (written BEFORE the card reader is used, so a power cut can be recovered),
 * the sync outbox and the subscription cache for offline QR validation.
 * The schema is shared by every platform; the driver (see ./sql) decides how it reaches disk.
 */
import type { SqlDatabase } from './sql';

export type Db = SqlDatabase;

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS local_orders (
     local_id TEXT PRIMARY KEY,
     server_id TEXT,
     order_number TEXT NOT NULL,
     kind TEXT NOT NULL,
     status TEXT NOT NULL,
     offline INTEGER NOT NULL DEFAULT 0,
     mobile TEXT NOT NULL,
     payload TEXT NOT NULL,
     qr_token TEXT,
     qr_token_hash TEXT,
     offline_enqueued INTEGER NOT NULL DEFAULT 0,
     sync_pending INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS payment_journal (
     attempt_id TEXT PRIMARY KEY,
     local_order_id TEXT NOT NULL,
     amount INTEGER NOT NULL,
     state TEXT NOT NULL,
     terminal_ref TEXT,
     rrn TEXT,
     trace_no TEXT,
     message TEXT,
     source TEXT,
     inquiries INTEGER NOT NULL DEFAULT 0,
     started_at TEXT NOT NULL,
     resolved_at TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_journal_order ON payment_journal(local_order_id);
   CREATE INDEX IF NOT EXISTS idx_journal_state ON payment_journal(state);
   CREATE TABLE IF NOT EXISTS outbox (
     event_id TEXT PRIMARY KEY,
     type TEXT NOT NULL,
     payload TEXT NOT NULL,
     created_at TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'PENDING',
     attempts INTEGER NOT NULL DEFAULT 0,
     last_error TEXT,
     next_attempt_at TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, created_at);
   CREATE TABLE IF NOT EXISTS subscription_cache (
     token_hash TEXT PRIMARY KEY,
     subscription_id TEXT NOT NULL UNIQUE,
     customer_key TEXT NOT NULL,
     starts_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     status TEXT NOT NULL,
     plan_title TEXT NOT NULL,
     member_tail TEXT NOT NULL,
     rev INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_subcache_customer ON subscription_cache(customer_key);
   CREATE TABLE IF NOT EXISTS media_cache (
     checksum TEXT PRIMARY KEY,
     mime TEXT NOT NULL,
     path TEXT NOT NULL,
     size INTEGER NOT NULL,
     downloaded_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);`,
];

/** Applies pending schema migrations (tracked in PRAGMA user_version). */
export function migrate(db: Db): Db {
  for (let v = db.userVersion(); v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.setUserVersion(v + 1);
    })();
  }
  return db;
}

export function kvGet<T>(db: Db, key: string): T | null {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}

export function kvSet(db: Db, key: string, value: unknown) {
  db.prepare(
    'INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

export function nextCounter(db: Db, name: string): number {
  const row = db
    .prepare('INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value')
    .get(name) as { value: number };
  return row.value;
}
