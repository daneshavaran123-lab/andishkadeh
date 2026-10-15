/**
 * Minimal synchronous SQLite surface the kiosk core needs. Two drivers implement it:
 *  - better-sqlite3 (Electron / Node): writes go straight to disk with synchronous=FULL.
 *  - sql.js (web app / Android WebView): the database lives in memory and is persisted to
 *    IndexedDB; `flush()` waits until everything written so far is stored.
 * Parameters are positional (`?`) or a single object for `@name` placeholders.
 */
export interface SqlStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqlDatabase {
  readonly driver: string;
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
  /** Wraps fn in a transaction (nested calls become savepoints), like better-sqlite3. */
  transaction<T>(fn: () => T): () => T;
  userVersion(): number;
  setUserVersion(version: number): void;
  /** Resolves once every committed write is on durable storage. No-op for write-through drivers. */
  flush(): Promise<void>;
  close(): void;
}
