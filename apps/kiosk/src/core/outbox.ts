import { randomUUID } from 'node:crypto';
import type { SyncEvent, SyncEventType, SyncPushResponse } from '@andishkadeh/shared';
import type { Db } from './db';

interface OutboxRow {
  event_id: string;
  type: SyncEventType;
  payload: string;
  created_at: string;
  status: 'PENDING' | 'FAILED' | 'DONE';
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
}

/** Durable queue of device-authoritative events (sales, payment results, access logs, prints). */
export class Outbox {
  constructor(private readonly db: Db) {}

  enqueue<T extends SyncEvent['type']>(type: T, payload: Extract<SyncEvent, { type: T }>['payload']): string {
    const eventId = randomUUID();
    this.db
      .prepare('INSERT INTO outbox (event_id, type, payload, created_at) VALUES (?, ?, ?, ?)')
      .run(eventId, type, JSON.stringify(payload), new Date().toISOString());
    return eventId;
  }

  due(limit = 50, now = new Date()): SyncEvent[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM outbox WHERE status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at, rowid LIMIT ?",
      )
      .all(now.toISOString(), limit) as OutboxRow[];
    return rows.map((r) => ({ eventId: r.event_id, type: r.type, createdAt: r.created_at, payload: JSON.parse(r.payload) }) as SyncEvent);
  }

  /** Applies a push response: accepted → DONE, retryable → backoff, non-retryable → FAILED (visible in admin). */
  applyResponse(res: SyncPushResponse) {
    const now = Date.now();
    const done = this.db.prepare("UPDATE outbox SET status = 'DONE', last_error = NULL WHERE event_id = ?");
    const retry = this.db.prepare(
      'UPDATE outbox SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE event_id = ?',
    );
    const fail = this.db.prepare("UPDATE outbox SET status = 'FAILED', attempts = attempts + 1, last_error = ? WHERE event_id = ?");
    const tx = this.db.transaction(() => {
      res.acceptedEventIds.forEach((id) => done.run(id));
      for (const r of res.rejectedEvents) {
        if (r.retryable) {
          const row = this.db.prepare('SELECT attempts FROM outbox WHERE event_id = ?').get(r.eventId) as { attempts: number } | undefined;
          const backoff = Math.min(15 * 60_000, 5_000 * 2 ** Math.min(row?.attempts ?? 0, 8));
          retry.run(`${r.code}: ${r.message}`, new Date(now + backoff).toISOString(), r.eventId);
        } else {
          fail.run(`${r.code}: ${r.message}`, r.eventId);
        }
      }
    });
    tx();
  }

  /** Network failure: keep everything pending, back off a little. */
  deferAll(events: SyncEvent[], error: string) {
    const stmt = this.db.prepare('UPDATE outbox SET last_error = ?, next_attempt_at = ? WHERE event_id = ?');
    const at = new Date(Date.now() + 5_000).toISOString();
    const tx = this.db.transaction(() => events.forEach((e) => stmt.run(error, at, e.eventId)));
    tx();
  }

  /** Admin "retry": FAILED events go back to the queue. Server-side idempotency prevents duplicates. */
  requeueFailed(): number {
    return this.db.prepare("UPDATE outbox SET status = 'PENDING', next_attempt_at = NULL WHERE status = 'FAILED'").run().changes;
  }

  stats(): { pending: number; failed: number; oldestPendingAt: string | null } {
    const row = this.db
      .prepare(
        "SELECT SUM(status = 'PENDING') AS pending, SUM(status = 'FAILED') AS failed, MIN(CASE WHEN status = 'PENDING' THEN created_at END) AS oldest FROM outbox",
      )
      .get() as { pending: number | null; failed: number | null; oldest: string | null };
    return { pending: row.pending ?? 0, failed: row.failed ?? 0, oldestPendingAt: row.oldest };
  }

  /** DONE rows are only kept for a week for troubleshooting. */
  prune(days = 7) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    this.db.prepare("DELETE FROM outbox WHERE status = 'DONE' AND created_at < ?").run(cutoff);
  }
}
