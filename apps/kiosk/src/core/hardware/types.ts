/**
 * Hardware adapter contracts (PRD §16). Real card reader / printer / scanner models are not
 * confirmed yet, so only these interfaces are fixed; concrete SDK integrations plug in here.
 * Mock adapters exist for development and are always reported as simulated in the UI.
 */
import type { HardwareStatus, ReceiptData, TerminalOutcome } from '@andishkadeh/shared';

export interface TerminalResult {
  outcome: TerminalOutcome;
  terminalRef: string | null;
  rrn: string | null;
  traceNo: string | null;
  message: string | null;
}

export interface PaymentRequest {
  amount: number;
  /** Shown on the terminal / bank report (order number). */
  orderRef: string;
  /** Our idempotency key for this attempt. */
  attemptId: string;
}

export interface PaymentAdapter {
  readonly name: string;
  readonly isMock: boolean;
  status(): Promise<HardwareStatus>;
  /** Must resolve with UNKNOWN (not throw) when the terminal outcome can not be determined. */
  initiate(req: PaymentRequest, signal: AbortSignal): Promise<TerminalResult>;
  /** Re-query the terminal/bank about an attempt whose result is unknown. */
  inquire(ref: { attemptId: string; terminalRef: string | null; amount: number }): Promise<TerminalResult>;
  /** Best-effort cancel before the card is presented; false when unsupported. */
  cancelIfSupported(attemptId: string): Promise<boolean>;
}

export interface PrinterAdapter {
  readonly name: string;
  readonly isMock: boolean;
  status(): Promise<HardwareStatus>;
  print(receipt: ReceiptData): Promise<{ ok: boolean; detail: string | null }>;
}

export interface ScannerAdapter {
  readonly name: string;
  readonly isMock: boolean;
  status(): Promise<HardwareStatus>;
  /** Subscribe to scans produced by the adapter itself (serial / mock). Keyboard-wedge scans arrive from the UI. */
  onScan(cb: (payload: string) => void): () => void;
}

/** Card details (PAN/CVV) never reach this code: terminals only return references. */
export const NO_CARD_DATA_NOTICE = 'PAN/CVV are never read, stored or logged by the kiosk.';
