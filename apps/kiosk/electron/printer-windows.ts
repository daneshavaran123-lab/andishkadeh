/**
 * Prints receipts through the installed Windows printer driver (silent, no dialog).
 * Works with any thermal printer that ships a Windows driver; Persian shaping is handled by
 * Chromium. The exact printer model is still to be confirmed (PRD §22): this adapter is
 * "ready to connect" and must be verified on the real device before go-live.
 */
import { BrowserWindow, type PrinterInfo, type WebContents } from 'electron';
import { HardwareState, type HardwareStatus, type ReceiptData } from '@andishkadeh/shared';
import { receiptHtml } from '../src/core/hardware/receipt';
import type { PrinterAdapter } from '../src/core/hardware/types';

const PRINTER_LIST_TTL_MS = 60_000;
const PRINT_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((resolve) => (timer = setTimeout(() => resolve(onTimeout()), ms)))]).finally(() => clearTimeout(timer));
}

export class WindowsDriverPrinter implements PrinterAdapter {
  readonly name = 'windows-driver';
  readonly isMock = false;
  private lastError: string | null = null;
  private printers: { at: number; list: PrinterInfo[] } | null = null;

  /** `contents` is the kiosk window, reused for printer queries instead of a window per health check. */
  constructor(
    private readonly deviceName?: string,
    private readonly contents: () => WebContents | null = () => null,
  ) {}

  private async listPrinters(): Promise<PrinterInfo[]> {
    if (this.printers && Date.now() - this.printers.at < PRINTER_LIST_TTL_MS) return this.printers.list;
    const wc = this.contents();
    const probe = wc && !wc.isDestroyed() ? null : new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    try {
      const list = await withTimeout((probe?.webContents ?? wc!).getPrintersAsync(), 10_000, () =>
        Promise.reject(new Error('فهرست چاپگرهای ویندوز در مهلت مقرر دریافت نشد')),
      );
      this.printers = { at: Date.now(), list };
      return list;
    } finally {
      probe?.destroy();
    }
  }

  async status(): Promise<HardwareStatus> {
    if (!this.deviceName) {
      return { state: HardwareState.WARNING, adapter: this.name, detail: 'نام چاپگر در تنظیمات کیوسک (printerName) مشخص نشده است' };
    }
    let printers: PrinterInfo[];
    try {
      printers = await this.listPrinters();
    } catch (e) {
      return { state: HardwareState.UNKNOWN, adapter: this.name, detail: (e as Error).message };
    }
    const target = printers.find((p) => p.name === this.deviceName);
    if (!target) return { state: HardwareState.ERROR, adapter: this.name, detail: `چاپگر «${this.deviceName}» در ویندوز یافت نشد` };
    if (this.lastError) return { state: HardwareState.WARNING, adapter: this.name, detail: `آخرین خطا: ${this.lastError}` };
    // Windows drivers rarely expose paper status reliably → reported as unknown, not "OK".
    return { state: HardwareState.UNKNOWN, adapter: this.name, detail: `${target.displayName || target.name}` };
  }

  async print(receipt: ReceiptData): Promise<{ ok: boolean; detail: string | null }> {
    const html = await receiptHtml(receipt);
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    try {
      await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const printed = new Promise<{ ok: boolean; detail: string | null }>((resolve) => {
        w.webContents.print(
          { silent: true, printBackground: true, deviceName: this.deviceName, margins: { marginType: 'none' } },
          (success, reason) => resolve({ ok: success, detail: success ? null : reason || 'چاپ انجام نشد' }),
        );
      });
      // A stuck driver or spooler must not leave the customer on the printing screen.
      const result = await withTimeout(printed, PRINT_TIMEOUT_MS, () => ({ ok: false, detail: 'چاپگر در مهلت مقرر پاسخ نداد' }));
      this.lastError = result.ok ? null : result.detail;
      return result;
    } catch (e) {
      this.lastError = (e as Error).message;
      return { ok: false, detail: this.lastError };
    } finally {
      w.destroy();
    }
  }
}
