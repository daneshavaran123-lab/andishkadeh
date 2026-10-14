import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HardwareState, type HardwareStatus, type ReceiptData } from '@andishkadeh/shared';
import { receiptHtml, receiptText } from './receipt';
import type { PrinterAdapter, ScannerAdapter } from './types';

/**
 * Simulated thermal printer: writes each receipt as .txt and .html into <dataDir>/receipts.
 * Modes allow testing paper-out / offline handling (PRD §19: print failure keeps the order).
 */
export class MockPrinterAdapter implements PrinterAdapter {
  readonly name = 'mock-printer';
  readonly isMock = true;
  mode: 'ok' | 'paper-out' | 'offline' = 'ok';
  readonly printed: string[] = [];

  constructor(private readonly dir: string) {}

  async status(): Promise<HardwareStatus> {
    if (this.mode === 'paper-out') return { state: HardwareState.ERROR, adapter: this.name, detail: 'کاغذ چاپگر تمام شده است' };
    if (this.mode === 'offline') return { state: HardwareState.ERROR, adapter: this.name, detail: 'چاپگر در دسترس نیست' };
    return { state: HardwareState.OK, adapter: this.name, detail: 'چاپگر شبیه‌سازی‌شده' };
  }

  async print(receipt: ReceiptData): Promise<{ ok: boolean; detail: string | null }> {
    await new Promise((r) => setTimeout(r, 600));
    if (this.mode !== 'ok') return { ok: false, detail: (await this.status()).detail };
    mkdirSync(this.dir, { recursive: true });
    const base = join(this.dir, `${receipt.orderNumber}${receipt.reprint ? '-reprint' : ''}-${Date.now()}`);
    writeFileSync(`${base}.txt`, receiptText(receipt), 'utf8');
    writeFileSync(`${base}.html`, await receiptHtml(receipt), 'utf8');
    this.printed.push(receipt.orderNumber);
    return { ok: true, detail: null };
  }
}

/**
 * USB HID scanners in keyboard-wedge mode type the code followed by Enter; the UI captures it.
 * Presence of such a device can not be detected, hence status UNKNOWN (PRD H: "unknown" without SDK).
 */
export class KeyboardWedgeScanner implements ScannerAdapter {
  readonly name = 'hid-keyboard';
  readonly isMock = false;
  async status(): Promise<HardwareStatus> {
    return { state: HardwareState.UNKNOWN, adapter: this.name, detail: 'اسکنر USB در حالت صفحه‌کلید (قابل تشخیص خودکار نیست)' };
  }
  onScan(): () => void {
    return () => undefined;
  }
}

/** Dev/test scanner: scans are injected through dev controls. */
export class MockScanner implements ScannerAdapter {
  readonly name = 'mock-scanner';
  readonly isMock = true;
  mode: 'ok' | 'offline' = 'ok';
  private listeners = new Set<(p: string) => void>();
  async status(): Promise<HardwareStatus> {
    if (this.mode === 'offline') return { state: HardwareState.ERROR, adapter: this.name, detail: 'اسکنر در دسترس نیست' };
    return { state: HardwareState.OK, adapter: this.name, detail: 'اسکنر شبیه‌سازی‌شده' };
  }
  onScan(cb: (payload: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(payload: string) {
    if (this.mode === 'offline') return;
    this.listeners.forEach((l) => l(payload));
  }
}
