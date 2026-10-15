/**
 * Receipt printing for the web app and the Android app.
 *  - Browser: the receipt is printed from a hidden frame. Chrome/Edge started with
 *    --kiosk-printing print silently to the default printer; otherwise the print dialog opens.
 *  - Android: native KioskPrinter plugin (Android print service). Silent printing on a specific
 *    thermal printer needs that printer's SDK and stays an adapter to be connected (PRD §22).
 * Neither path can read paper status, so the printer is reported as UNKNOWN, never as OK.
 */
import { registerPlugin } from '@capacitor/core';
import { HardwareState, type HardwareStatus, type ReceiptData } from '@andishkadeh/shared';
import { receiptHtml } from '../../core/hardware/receipt';
import type { PrinterAdapter } from '../../core/hardware/types';

interface KioskPrinterPlugin {
  print(options: { html: string; jobName: string }): Promise<{ ok: boolean; detail?: string | null }>;
}
const KioskPrinter = registerPlugin<KioskPrinterPlugin>('KioskPrinter');

/** Receipt font as a data: URL so it also works inside print frames and native print views. */
function fontLoader(fontUrl?: string): () => Promise<string | undefined> {
  let cached: Promise<string | undefined> | null = null;
  return () =>
    (cached ??= (async () => {
      if (!fontUrl) return undefined;
      try {
        const blob = await (await fetch(fontUrl)).blob();
        return await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
      } catch {
        return undefined; // falls back to Tahoma / system fonts
      }
    })());
}

export class BrowserPrintAdapter implements PrinterAdapter {
  readonly name = 'browser-print';
  readonly isMock = false;
  private lastError: string | null = null;
  private readonly font: () => Promise<string | undefined>;

  constructor(fontUrl?: string) {
    this.font = fontLoader(fontUrl);
  }

  async status(): Promise<HardwareStatus> {
    if (this.lastError) return { state: HardwareState.WARNING, adapter: this.name, detail: `آخرین خطا: ${this.lastError}` };
    return { state: HardwareState.UNKNOWN, adapter: this.name, detail: 'چاپ از طریق مرورگر (وضعیت کاغذ قابل تشخیص نیست)' };
  }

  async print(receipt: ReceiptData): Promise<{ ok: boolean; detail: string | null }> {
    const html = await receiptHtml(receipt, await this.font());
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
    try {
      await new Promise<void>((resolve, reject) => {
        frame.onload = () => resolve();
        frame.onerror = () => reject(new Error('receipt frame failed to load'));
        frame.srcdoc = html;
        document.body.appendChild(frame);
      });
      const w = frame.contentWindow;
      if (!w) throw new Error('print frame unavailable');
      await w.document.fonts?.ready;
      w.focus();
      w.print(); // returns when the job is spooled (kiosk-printing) or the dialog is closed
      this.lastError = null;
      return { ok: true, detail: null };
    } catch (e) {
      this.lastError = (e as Error).message;
      return { ok: false, detail: this.lastError };
    } finally {
      setTimeout(() => frame.remove(), 1000);
    }
  }
}

export class AndroidPrintAdapter implements PrinterAdapter {
  readonly name = 'android-print';
  readonly isMock = false;
  private lastError: string | null = null;
  private readonly font: () => Promise<string | undefined>;

  constructor(fontUrl?: string) {
    this.font = fontLoader(fontUrl);
  }

  async status(): Promise<HardwareStatus> {
    if (this.lastError) return { state: HardwareState.WARNING, adapter: this.name, detail: `آخرین خطا: ${this.lastError}` };
    return { state: HardwareState.UNKNOWN, adapter: this.name, detail: 'سرویس چاپ اندروید (وضعیت کاغذ قابل تشخیص نیست)' };
  }

  async print(receipt: ReceiptData): Promise<{ ok: boolean; detail: string | null }> {
    try {
      const html = await receiptHtml(receipt, await this.font());
      const r = await KioskPrinter.print({ html, jobName: `receipt-${receipt.orderNumber}` });
      this.lastError = r.ok ? null : (r.detail ?? 'چاپ انجام نشد');
      return { ok: r.ok, detail: r.ok ? null : this.lastError };
    } catch (e) {
      this.lastError = (e as Error).message;
      return { ok: false, detail: this.lastError };
    }
  }
}
