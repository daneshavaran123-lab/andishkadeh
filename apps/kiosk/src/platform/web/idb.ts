/** Small promise wrapper over IndexedDB: one database, a store for the SQLite snapshot and one for media. */
export type IdbStoreName = 'sqlite' | 'media';

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export class Idb {
  private constructor(private readonly db: IDBDatabase) {}

  static open(name: string): Promise<Idb> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => {
        for (const s of ['sqlite', 'media']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
      };
      r.onsuccess = () => resolve(new Idb(r.result));
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    });
  }

  async get<T>(store: IdbStoreName, key: string): Promise<T | undefined> {
    return req(this.db.transaction(store, 'readonly').objectStore(store).get(key)) as Promise<T | undefined>;
  }

  /** `strict` asks the browser to flush to disk before reporting success (used for the database snapshot). */
  put(store: IdbStoreName, key: string, value: unknown, strict = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite', { durability: strict ? 'strict' : 'default' });
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  }

  async entries<T>(store: IdbStoreName): Promise<Array<[string, T]>> {
    const os = this.db.transaction(store, 'readonly').objectStore(store);
    const [keys, values] = await Promise.all([req(os.getAllKeys()), req(os.getAll())]);
    return keys.map((k, i) => [String(k), values[i] as T]);
  }

  close() {
    this.db.close();
  }
}

/** Removes every local kiosk record of this browser (technician "reset device"). */
export function deleteIdb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => resolve();
  });
}
