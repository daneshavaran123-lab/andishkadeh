/**
 * Node host of the kiosk core (Electron main process, dev bridge, integration tests):
 * SQLite file, media files under <dataDir>/media, simulated receipts under <dataDir>/receipts.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KioskConfig } from '../../core/config';
import { MockPrinterAdapter, type ReceiptSink } from '../../core/hardware/printer';
import type { PrinterAdapter } from '../../core/hardware/types';
import { KioskCore } from '../../core/kiosk-core';
import { MEDIA_EXT, type MediaStore } from '../../core/media';
import type { SqlDatabase } from '../../core/sql';
import { openNodeDatabase } from './sqlite';

export { loadConfig } from './config';
export { openNodeDatabase } from './sqlite';

export class FsMediaStore implements MediaStore {
  constructor(private readonly dir: string) {}

  exists(locator: string): boolean {
    return existsSync(locator);
  }

  async put(checksum: string, mime: string, bytes: Uint8Array): Promise<string> {
    mkdirSync(this.dir, { recursive: true });
    const path = join(this.dir, `${checksum}.${MEDIA_EXT[mime] ?? 'bin'}`);
    writeFileSync(`${path}.part`, bytes);
    renameSync(`${path}.part`, path);
    return path;
  }
}

/** Simulated printer output: <dir>/<order>-<time>.txt and .html. */
export function fileReceiptSink(dir: string): ReceiptSink {
  return (name, files) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.txt`), files.txt, 'utf8');
    writeFileSync(join(dir, `${name}.html`), files.html, 'utf8');
  };
}

export interface NodeCoreOptions {
  mediaBase: string;
  /** Real printer (Electron injects the Windows-driver printer); default: simulated, files in <dataDir>/receipts. */
  printer?: PrinterAdapter;
  /** Database to use instead of <dataDir>/kiosk.sqlite (tests run the core on sql.js too). */
  db?: SqlDatabase;
}

export function createNodeCore(cfg: KioskConfig, opts: NodeCoreOptions): KioskCore {
  return new KioskCore(cfg, {
    mediaBase: opts.mediaBase,
    db: opts.db ?? openNodeDatabase(join(cfg.dataDir, 'kiosk.sqlite')),
    media: new FsMediaStore(join(cfg.dataDir, 'media')),
    printer: opts.printer ?? new MockPrinterAdapter(fileReceiptSink(join(cfg.dataDir, 'receipts'))),
  });
}
