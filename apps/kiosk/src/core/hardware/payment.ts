import { HardwareState, TerminalOutcome, type HardwareStatus } from '@andishkadeh/shared';
import type { PaymentAdapter, PaymentRequest, TerminalResult } from './types';

export type PosScenario = 'approve' | 'decline' | 'unknown' | 'timeout' | 'cancel';

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    });
  });

/**
 * Simulated card reader for development and automated tests. It keeps a "bank ledger" so an
 * UNKNOWN/timeout attempt can later be resolved by inquiry, like a real acquirer would.
 * NOT a real integration — the UI shows a test-mode banner whenever this adapter is active.
 */
export class MockPaymentAdapter implements PaymentAdapter {
  readonly name = 'mock-pos';
  readonly isMock = true;
  scenario: PosScenario = 'approve';
  /** What the bank "really" did for unknown/timeout attempts. */
  hiddenTruth: 'PAID' | 'FAILED' = 'PAID';
  inquiryMode: 'truth' | 'unknown' = 'truth';
  delayMs = 1800;
  private ledger = new Map<string, TerminalResult>();
  private seq = 1000;

  async status(): Promise<HardwareStatus> {
    return { state: HardwareState.OK, adapter: this.name, detail: 'کارتخوان شبیه‌سازی‌شده' };
  }

  private paid(): TerminalResult {
    const ref = `MOCK-${++this.seq}`;
    return { outcome: TerminalOutcome.PAID, terminalRef: ref, rrn: String(100000000000 + this.seq), traceNo: String(this.seq), message: null };
  }

  async initiate(req: PaymentRequest, signal: AbortSignal): Promise<TerminalResult> {
    await sleep(this.delayMs, signal).catch(() => undefined);
    const truth = this.hiddenTruth === 'PAID' ? this.paid() : failed('رد شده توسط بانک');
    switch (this.scenario) {
      case 'approve': {
        const r = this.paid();
        this.ledger.set(req.attemptId, r);
        return r;
      }
      case 'decline':
        this.ledger.set(req.attemptId, failed('موجودی کافی نیست'));
        return failed('موجودی کافی نیست');
      case 'cancel':
        this.ledger.set(req.attemptId, { ...failed('لغو توسط کاربر'), outcome: TerminalOutcome.CANCELLED });
        return { ...failed('لغو توسط کاربر'), outcome: TerminalOutcome.CANCELLED };
      case 'unknown':
        this.ledger.set(req.attemptId, truth);
        return { outcome: TerminalOutcome.UNKNOWN, terminalRef: truth.terminalRef, rrn: null, traceNo: null, message: 'پاسخ کارتخوان دریافت نشد' };
      case 'timeout':
        this.ledger.set(req.attemptId, truth);
        // Never answers: the caller's abort/timeout turns this into UNKNOWN.
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
        return { outcome: TerminalOutcome.UNKNOWN, terminalRef: null, rrn: null, traceNo: null, message: 'مهلت پاسخ کارتخوان تمام شد' };
    }
  }

  async inquire(ref: { attemptId: string }): Promise<TerminalResult> {
    await sleep(400);
    if (this.inquiryMode === 'unknown') {
      return { outcome: TerminalOutcome.UNKNOWN, terminalRef: null, rrn: null, traceNo: null, message: 'استعلام پاسخ نداد' };
    }
    return this.ledger.get(ref.attemptId) ?? failed('تراکنشی با این شناسه یافت نشد');
  }

  async cancelIfSupported(): Promise<boolean> {
    return true;
  }
}

/** Used when no card-reader SDK is configured: sales are blocked, status is UNKNOWN. */
export class UnconfiguredPaymentAdapter implements PaymentAdapter {
  readonly name = 'not-configured';
  readonly isMock = false;

  async status(): Promise<HardwareStatus> {
    return { state: HardwareState.UNKNOWN, adapter: this.name, detail: 'SDK کارتخوان پیکربندی نشده است' };
  }

  async initiate(): Promise<TerminalResult> {
    return failed('کارتخوان پیکربندی نشده است');
  }

  async inquire(): Promise<TerminalResult> {
    return { outcome: TerminalOutcome.UNKNOWN, terminalRef: null, rrn: null, traceNo: null, message: 'کارتخوان پیکربندی نشده است' };
  }

  async cancelIfSupported(): Promise<boolean> {
    return false;
  }
}

function failed(message: string): TerminalResult {
  return { outcome: TerminalOutcome.FAILED, terminalRef: null, rrn: null, traceNo: null, message };
}
