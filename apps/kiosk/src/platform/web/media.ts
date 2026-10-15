import type { MediaStore } from '../../core/media';
import type { Idb } from './idb';

interface MediaRecord {
  mime: string;
  blob: Blob;
}

/**
 * Verified catalogue images as IndexedDB blobs. Each one gets an object URL at startup, so the
 * UI can show images synchronously and fully offline. The locator stored in SQLite is the checksum.
 */
export class IdbMediaStore implements MediaStore {
  private readonly urls = new Map<string, string>();

  private constructor(private readonly idb: Idb) {}

  static async open(idb: Idb): Promise<IdbMediaStore> {
    const store = new IdbMediaStore(idb);
    for (const [checksum, rec] of await idb.entries<MediaRecord>('media')) {
      if (rec?.blob) store.urls.set(checksum, URL.createObjectURL(rec.blob));
    }
    return store;
  }

  exists(locator: string): boolean {
    return this.urls.has(locator);
  }

  async put(checksum: string, mime: string, bytes: Uint8Array): Promise<string> {
    const blob = new Blob([bytes as BlobPart], { type: mime });
    await this.idb.put('media', checksum, { mime, blob } satisfies MediaRecord);
    const old = this.urls.get(checksum);
    if (old) URL.revokeObjectURL(old);
    this.urls.set(checksum, URL.createObjectURL(blob));
    return checksum;
  }

  url(checksum: string): string | null {
    return this.urls.get(checksum) ?? null;
  }
}
