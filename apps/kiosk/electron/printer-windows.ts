/**
 * Prints receipts through the installed Windows printer driver (silent, no dialog).
 * Works with any thermal printer that ships a Windows driver; Persian shaping is handled by
 * Chromium. The exact printer model is still to be confirmed (PRD §22): this adapter is
 * "ready to connect" and must be verified on the real device before go-live.
 */
import { BrowserWindow } from 'electron';
import { HardwareState, type HardwareStatus, type ReceiptData } from '@andishkadeh/shared';
import { receiptHtml } from '../src/core/hardware/receipt';
import type { PrinterAdapter } from '../src/core/hardware/types';

export class WindowsDriverPrinter implements PrinterAdapter {
  readonly name = 'windows-driver';
  readonly isMock = false;
  private lastError: string | null = null;

  constructor(private readonly deviceName?: string) {}

  async status(): Promise<HardwareStatus> {
    const probe = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    try {
      const printers = await probe.webContents.getPrintersAsync();
      if (!this.deviceName) {
        return { state: HardwareState.WARNING, adapter: this.name, detail: 'نام چاپگر در تنظیمات کیوسک (printerName) مشخص نشده است' };
      }
      const target = printers.find((p) => p.name === this.deviceName);
      if (!target) return { state: HardwareState.ERROR, adapter: this.name, detail: `چاپگر «${this.deviceName}» در ویندوز یافت نشد` };
      if (this.lastError) return { state: HardwareState.WARNING, adapter: this.name, detail: `آخرین خطا: ${this.lastError}` };
      // Windows drivers rarely expose paper status reliably → reported as unknown, not "OK".
      return { state: HardwareState.UNKNOWN, adapter: this.name, detail: `${target.displayName || target.name}` };
    } finally {
      probe.destroy();
    }
  }

  async print(receipt: ReceiptData): Promise<{ ok: boolean; detail: string | null }> {
    const html = await receiptHtml(receipt);
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    try {
      await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const result = await new Promise<{ ok: boolean; detail: string | null }>((resolve) => {
        w.webContents.print(
          { silent: true, printBackground: true, deviceName: this.deviceName, margins: { marginType: 'none' } },
          (success, reason) => resolve({ ok: success, detail: success ? null : reason || 'چاپ انجام نشد' }),
        );
      });
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
