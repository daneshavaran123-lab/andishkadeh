/**
 * Catalogue snapshot + media cache.
 *  - The last *good* bootstrap is kept in SQLite and used whenever the server is unreachable.
 *  - Media files are verified (sha256) before use; when a new image could not be downloaded the
 *    entity keeps showing its previous cached image instead of a blank (PRD §15, A-07).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Bootstrap } from '@andishkadeh/shared';
import type { ApiClient } from './api-client';
import { type Db, kvGet, kvSet } from './db';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export class CatalogStore {
  private effective: Bootstrap | null;

  constructor(
    private readonly db: Db,
    private readonly api: ApiClient,
    private readonly mediaDir: string,
  ) {
    const saved = kvGet<unknown>(db, 'bootstrap.effective');
    const parsed = saved ? Bootstrap.safeParse(saved) : null;
    this.effective = parsed?.success ? parsed.data : null;
  }

  get current(): Bootstrap | null {
    return this.effective;
  }

  get updatedAt(): string | null {
    const row = this.db.prepare("SELECT updated_at FROM kv WHERE key = 'bootstrap.effective'").get() as { updated_at: string } | undefined;
    return row?.updated_at ?? null;
  }

  /** Called after every successful pull, even when nothing changed: the snapshot is confirmed current. */
  markVerified(at = new Date()) {
    kvSet(this.db, 'catalog.verifiedAt', at.toISOString());
  }

  /** Hours since the snapshot was last confirmed with the server (offline sales stop after the configured max). */
  ageHours(now = Date.now()): number | null {
    const at = kvGet<string>(this.db, 'catalog.verifiedAt') ?? this.updatedAt;
    return at ? (now - new Date(at).getTime()) / 3_600_000 : null;
  }

  mediaPath(checksum: string): { path: string; mime: string } | null {
    const row = this.db.prepare('SELECT path, mime FROM media_cache WHERE checksum = ?').get(checksum) as { path: string; mime: string } | undefined;
    if (!row || !existsSync(row.path)) return null;
    return row;
  }

  private cached(checksum: string): boolean {
    return this.mediaPath(checksum) !== null;
  }

  private async fetchMedia(ref: Bootstrap['media'][number]): Promise<boolean> {
    if (this.cached(ref.checksum)) return true;
    try {
      const buf = await this.api.download(ref.url);
      const sum = createHash('sha256').update(buf).digest('hex');
      if (sum !== ref.checksum) return false; // corrupted or tampered download: keep the old image
      mkdirSync(this.mediaDir, { recursive: true });
      const path = join(this.mediaDir, `${ref.checksum}.${EXT[ref.mime] ?? 'bin'}`);
      writeFileSync(`${path}.part`, buf);
      renameSync(`${path}.part`, path);
      this.db
        .prepare('INSERT OR REPLACE INTO media_cache (checksum, mime, path, size, downloaded_at) VALUES (?, ?, ?, ?, ?)')
        .run(ref.checksum, ref.mime, path, buf.length, new Date().toISOString());
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Accepts a new server snapshot. Prices/texts apply immediately; images switch only once
   * downloaded. Returns true when the effective catalogue changed.
   */
  async accept(raw: Bootstrap): Promise<boolean> {
    kvSet(this.db, 'bootstrap.raw', raw);
    return this.refreshEffective();
  }

  /** Retry missing media of the last raw snapshot (called on every pull). */
  async refreshEffective(): Promise<boolean> {
    const rawJson = kvGet<unknown>(this.db, 'bootstrap.raw');
    const parsed = rawJson ? Bootstrap.safeParse(rawJson) : null;
    if (!parsed?.success) return false;
    const raw = parsed.data;
    const results = await Promise.all(raw.media.map((m) => this.fetchMedia(m)));
    const ok = new Set(raw.media.filter((_, i) => results[i]).map((m) => m.id));

    const prev = this.effective;
    const prevMedia = new Map((prev?.media ?? []).map((m) => [m.id, m]));
    const usable = (id: string | null) => !!id && (ok.has(id) || (prevMedia.has(id) && this.cached(prevMedia.get(id)!.checksum)));
    const pick = (next: string | null, old: string | null | undefined): string | null => {
      if (!next) return null;
      if (usable(next)) return next;
      return old && usable(old) ? old : null;
    };

    const prevCat = new Map((prev?.categories ?? []).map((c) => [c.id, c]));
    const effective: Bootstrap = {
      ...raw,
      settings: { ...raw.settings, logoMediaId: pick(raw.settings.logoMediaId, prev?.settings.logoMediaId) },
      content: {
        ...raw.content,
        welcome: { ...raw.content.welcome, heroMediaId: pick(raw.content.welcome.heroMediaId, prev?.content.welcome.heroMediaId) },
      },
      categories: raw.categories.map((c) => {
        const pc = prevCat.get(c.id);
        const prevSubs = new Map((pc?.subcategories ?? []).map((s) => [s.id, s]));
        return {
          ...c,
          mediaId: pick(c.mediaId, pc?.mediaId),
          subcategories: c.subcategories.map((s) => {
            const ps = prevSubs.get(s.id);
            const prevSvc = new Map((ps?.services ?? []).map((x) => [x.id, x]));
            return {
              ...s,
              mediaId: pick(s.mediaId, ps?.mediaId),
              services: s.services.map((x) => ({ ...x, mediaId: pick(x.mediaId, prevSvc.get(x.id)?.mediaId) })),
            };
          }),
        };
      }),
      // Only media that is actually on disk is advertised to the UI.
      media: [...raw.media.filter((m) => ok.has(m.id)), ...(prev?.media ?? []).filter((m) => !ok.has(m.id) && this.cached(m.checksum))],
    };

    const changed = JSON.stringify(effective) !== JSON.stringify(prev);
    if (changed) {
      kvSet(this.db, 'bootstrap.effective', effective);
      this.effective = effective;
    }
    return changed;
  }
}
