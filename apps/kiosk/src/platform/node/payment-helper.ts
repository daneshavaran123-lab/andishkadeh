/**
 * Card terminal driven by a helper program: the bank's PC-POS SDK (usually a Windows .NET library)
 * is wrapped in a small executable that the kiosk starts once and talks to with one JSON object
 * per line on stdin/stdout. Protocol and requirements: docs/payment-helper.md.
 *
 * Safety: once a sale request has reached the helper, anything but a clear answer (crash, garbage,
 * timeout) is UNKNOWN, never FAILED, so the core keeps inquiring instead of letting the customer
 * pay twice. A helper that could not even be started is FAILED: no card was presented.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { HardwareState, TerminalOutcome, type HardwareStatus } from '@andishkadeh/shared';
import { z } from 'zod';
import type { PaymentAdapter, PaymentRequest, TerminalResult } from '../../core/hardware/types';

const ResultLine = z.object({
  outcome: z.enum([TerminalOutcome.PAID, TerminalOutcome.FAILED, TerminalOutcome.CANCELLED, TerminalOutcome.UNKNOWN]),
  terminalRef: z.string().nullish(),
  rrn: z.string().nullish(),
  traceNo: z.string().nullish(),
  message: z.string().nullish(),
});
const StatusLine = z.object({ state: z.enum([HardwareState.OK, HardwareState.WARNING, HardwareState.ERROR, HardwareState.UNKNOWN]), detail: z.string().nullish() });
const CancelLine = z.object({ cancelled: z.boolean() });

type Reply = Record<string, unknown>;
/** Why a request ended without an answer. */
type NoReply = 'not-started' | 'gone' | 'timeout' | 'aborted';

export interface HelperTimeouts {
  statusMs: number;
  inquireMs: number;
  cancelMs: number;
}

export class HelperPaymentAdapter implements PaymentAdapter {
  readonly name: string;
  readonly isMock = false;
  private child: ChildProcess | null = null;
  private starting: Promise<ChildProcess> | null = null;
  private readonly waiting = new Map<string, (reply: Reply | 'gone') => void>();
  private saleInProgress = false;

  constructor(
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly timeouts: HelperTimeouts = { statusMs: 5000, inquireMs: 30_000, cancelMs: 5000 },
  ) {
    this.name = `helper:${basename(command)}`;
  }

  async status(): Promise<HardwareStatus> {
    // The helper may handle one command at a time; do not report a busy terminal as broken.
    if (this.saleInProgress) return { state: HardwareState.OK, adapter: this.name, detail: 'در حال تراکنش' };
    const reply = await this.request({ cmd: 'status' }, this.timeouts.statusMs);
    const parsed = typeof reply === 'string' ? null : StatusLine.safeParse(reply);
    if (!parsed?.success) return { state: HardwareState.ERROR, adapter: this.name, detail: noReplyText(typeof reply === 'string' ? reply : 'gone') };
    return { state: parsed.data.state, adapter: this.name, detail: parsed.data.detail ?? null };
  }

  async initiate(req: PaymentRequest, signal: AbortSignal): Promise<TerminalResult> {
    this.saleInProgress = true;
    try {
      // Terminals take rials; the kiosk works in tomans.
      const reply = await this.request({ cmd: 'sale', amountRial: req.amount * 10, amountToman: req.amount, orderRef: req.orderRef, attemptId: req.attemptId }, signal);
      if (reply === 'not-started') return result(TerminalOutcome.FAILED, 'برنامه کارتخوان اجرا نشد');
      return this.toResult(reply);
    } finally {
      this.saleInProgress = false;
    }
  }

  async inquire(ref: { attemptId: string; terminalRef: string | null; amount: number }): Promise<TerminalResult> {
    const reply = await this.request({ cmd: 'inquire', attemptId: ref.attemptId, terminalRef: ref.terminalRef, amountRial: ref.amount * 10, amountToman: ref.amount }, this.timeouts.inquireMs);
    return this.toResult(reply);
  }

  async cancelIfSupported(attemptId: string): Promise<boolean> {
    const reply = await this.request({ cmd: 'cancel', attemptId }, this.timeouts.cancelMs);
    const parsed = typeof reply === 'string' ? null : CancelLine.safeParse(reply);
    return !!parsed?.success && parsed.data.cancelled;
  }

  /** Stops the helper (kiosk shutdown). */
  stop(): void {
    this.child?.kill();
    this.child = null;
  }

  private toResult(reply: Reply | NoReply): TerminalResult {
    if (typeof reply === 'string') return result(TerminalOutcome.UNKNOWN, noReplyText(reply));
    const parsed = ResultLine.safeParse(reply);
    if (!parsed.success) return result(TerminalOutcome.UNKNOWN, 'پاسخ نامعتبر از برنامه کارتخوان');
    const r = parsed.data;
    return { outcome: r.outcome, terminalRef: r.terminalRef ?? null, rrn: r.rrn ?? null, traceNo: r.traceNo ?? null, message: r.message ?? null };
  }

  private async request(msg: Reply, limit: number | AbortSignal): Promise<Reply | NoReply> {
    let child: ChildProcess;
    try {
      child = await this.ensureStarted();
    } catch {
      return 'not-started';
    }
    const id = randomUUID();
    return new Promise<Reply | NoReply>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: Reply | NoReply) => {
        this.waiting.delete(id);
        if (timer) clearTimeout(timer);
        if (typeof limit !== 'number') limit.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const onAbort = () => finish('aborted');
      this.waiting.set(id, (reply) => finish(reply));
      if (typeof limit === 'number') timer = setTimeout(() => finish('timeout'), limit);
      else if (limit.aborted) return finish('aborted');
      else limit.addEventListener('abort', onAbort);
      child.stdin?.write(`${JSON.stringify({ id, ...msg })}\n`);
    });
  }

  private ensureStarted(): Promise<ChildProcess> {
    if (this.child) return Promise.resolve(this.child);
    this.starting ??= new Promise<ChildProcess>((resolve, reject) => {
      const child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          this.onLine(line);
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => console.warn(`[${this.name}] ${chunk.trimEnd()}`));
      child.stdin.on('error', () => undefined); // a dead helper surfaces through 'exit'
      child.once('spawn', () => {
        this.child = child;
        this.starting = null;
        resolve(child);
      });
      child.once('error', (e) => {
        this.starting = null;
        if (this.child !== child) reject(e);
      });
      child.once('exit', () => {
        if (this.child === child) this.child = null;
        // Every request still waiting will never be answered by this process.
        for (const done of [...this.waiting.values()]) done('gone');
      });
    });
    return this.starting;
  }

  private onLine(line: string) {
    if (!line) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      console.warn(`[${this.name}] ignored a line that is not JSON`);
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const { id, ...rest } = msg as { id?: unknown };
    if (typeof id === 'string') this.waiting.get(id)?.(rest);
  }
}

function result(outcome: TerminalOutcome, message: string): TerminalResult {
  return { outcome, terminalRef: null, rrn: null, traceNo: null, message };
}

function noReplyText(reason: NoReply | 'gone'): string {
  switch (reason) {
    case 'not-started':
      return 'برنامه کارتخوان اجرا نشد';
    case 'gone':
      return 'برنامه کارتخوان متوقف شد';
    case 'timeout':
    case 'aborted':
      return 'مهلت پاسخ کارتخوان تمام شد';
  }
}
