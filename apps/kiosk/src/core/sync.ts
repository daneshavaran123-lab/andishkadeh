/**
 * Background sync worker: push outbox → pull catalogue/subscriptions → heartbeat + device commands
 * → payment journal recovery. Push always happens before pull (PRD §15).
 */
import {
  DeviceCommandType,
  SyncEventType,
  TerminalOutcome,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type OrderDto,
  type ReceiptData,
  type SyncPullResponse,
  type SyncPushResponse,
} from '@andishkadeh/shared';
import { ApiClient, NetworkError } from './api-client';
import type { AccessService } from './access';
import type { CatalogStore } from './catalog';
import type { KioskConfig } from './config';
import { type Db, kvGet, kvSet } from './db';
import type { PaymentAdapter, PrinterAdapter, ScannerAdapter } from './hardware/types';
import type { Outbox } from './outbox';
import type { SalesService } from './sales';

export class SyncWorker {
  private timers: NodeJS.Timeout[] = [];
  private pushing = false;
  private pulling = false;

  constructor(
    private readonly db: Db,
    private readonly api: ApiClient,
    private readonly cfg: KioskConfig,
    private readonly catalog: CatalogStore,
    private readonly outbox: Outbox,
    private readonly sales: SalesService,
    private readonly access: AccessService,
    private readonly hw: { payment: PaymentAdapter; printer: PrinterAdapter; scanner: ScannerAdapter },
    private readonly events: { onCatalog: () => void; onStatus: () => void },
  ) {}

  get lastSyncAt(): string | null {
    return kvGet<string>(this.db, 'sync.lastAt');
  }

  start() {
    const i = this.cfg.intervals;
    void this.cycle(true);
    this.timers.push(setInterval(() => void this.push(), i.pushSec * 1000));
    this.timers.push(setInterval(() => void this.pull(), i.pullSec * 1000));
    this.timers.push(setInterval(() => void this.heartbeat(), i.heartbeatSec * 1000));
    this.timers.push(setInterval(() => void this.sales.recover().then((n) => n && this.events.onStatus()), i.recoverySec * 1000));
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  /** Full cycle; `startup` also recovers payments interrupted by a crash or power cut. */
  async cycle(startup = false) {
    if (startup) await this.sales.recover().catch(() => 0);
    await this.push();
    await this.pull();
    await this.heartbeat();
  }

  async push(): Promise<void> {
    if (this.pushing) return;
    this.pushing = true;
    try {
      for (let round = 0; round < 10; round++) {
        const batch = this.outbox.due(50);
        if (!batch.length) break;
        let res: SyncPushResponse;
        try {
          res = await this.api.post<SyncPushResponse>('/sync/push', { events: batch });
        } catch (e) {
          this.outbox.deferAll(batch, (e as Error).message);
          break;
        }
        this.outbox.applyResponse(res);
        // Apply server confirmations of offline payments to local orders.
        for (const ev of batch) {
          const r = res.results[ev.eventId] as { order?: OrderDto } | undefined;
          if (ev.type === SyncEventType.PAYMENT_RESULT && r?.order) this.sales.applyServerOrder(ev.payload.localOrderId, r.order);
        }
        kvSet(this.db, 'sync.lastAt', new Date().toISOString());
        if (res.rejectedEvents.length === batch.length) break;
      }
      this.outbox.prune(1);
    } finally {
      this.pushing = false;
      this.events.onStatus();
    }
  }

  async pull(): Promise<void> {
    if (this.pulling) return;
    this.pulling = true;
    try {
      let catalogChanged = false;
      for (let page = 0; page < 50; page++) {
        const since = this.catalog.current?.catalogRevision ?? 0;
        const subSince = kvGet<number>(this.db, 'sync.subRev') ?? 0;
        const res = await this.api.get<SyncPullResponse>(`/sync/pull?since=${since}&subSince=${subSince}`);
        if (res.catalog) catalogChanged = (await this.catalog.accept(res.catalog)) || catalogChanged;
        if (res.subscriptions.length) this.access.applyCache(res.subscriptions);
        kvSet(this.db, 'sync.subRev', res.nextSubRev);
        this.catalog.markVerified();
        kvSet(this.db, 'sync.lastAt', new Date().toISOString());
        if (res.subscriptions.length < 1000) break;
      }
      // Retry media that failed to download earlier.
      if (!catalogChanged) catalogChanged = await this.catalog.refreshEffective();
      if (catalogChanged) this.events.onCatalog();
    } catch (e) {
      if (!(e instanceof NetworkError)) console.warn('[sync] pull failed', (e as Error).message);
    } finally {
      this.pulling = false;
      this.events.onStatus();
    }
  }

  async heartbeat(): Promise<void> {
    const [pos, printer, scanner] = await Promise.all([this.hw.payment.status(), this.hw.printer.status(), this.hw.scanner.status()]);
    const stats = this.outbox.stats();
    const body: HeartbeatRequest = {
      appVersion: this.cfg.appVersion,
      catalogRevision: this.catalog.current?.catalogRevision ?? 0,
      subRev: kvGet<number>(this.db, 'sync.subRev') ?? 0,
      hardware: { pos, printer, scanner },
      outbox: stats,
      unresolvedPayments: this.sales.unresolvedCount(),
      lastSyncAt: this.lastSyncAt,
    };
    try {
      const res = await this.api.post<HeartbeatResponse>('/devices/heartbeat', body);
      if (res.catalogRevision > (this.catalog.current?.catalogRevision ?? 0)) void this.pull();
      for (const cmd of res.commands) await this.execute(cmd);
    } catch {
      // offline: status already reflects it
    } finally {
      this.events.onStatus();
    }
  }

  /** Device commands are idempotent by id (a command may be re-delivered). */
  private async execute(cmd: HeartbeatResponse['commands'][number]) {
    const doneKey = `cmd.done.${cmd.id}`;
    const prior = kvGet<{ success: boolean; result: unknown }>(this.db, doneKey);
    let outcome = prior;
    if (!outcome) {
      try {
        switch (cmd.type) {
          case DeviceCommandType.PAYMENT_INQUIRY: {
            const p = cmd.payload as { paymentAttemptId: string; localOrderId: string; terminalRef: string | null; amount: number };
            const r = await this.sales.inquireByAttempt(p.paymentAttemptId, p.terminalRef, p.amount);
            outcome = { success: r.outcome !== TerminalOutcome.UNKNOWN, result: { outcome: r.outcome, message: r.message } };
            break;
          }
          case DeviceCommandType.PRINT_RECEIPT: {
            const receipt = (cmd.payload as { receipt: ReceiptData }).receipt;
            const r = await this.hw.printer.print(receipt);
            outcome = { success: r.ok, result: { detail: r.detail } };
            break;
          }
          case DeviceCommandType.SYNC_NOW: {
            const requeued = (cmd.payload as { retryFailed?: boolean }).retryFailed ? this.outbox.requeueFailed() : 0;
            await this.push();
            await this.pull();
            outcome = { success: true, result: { requeued, outbox: this.outbox.stats() } };
            break;
          }
          default:
            outcome = { success: false, result: { error: 'unknown command' } };
        }
      } catch (e) {
        outcome = { success: false, result: { error: (e as Error).message } };
      }
      kvSet(this.db, doneKey, outcome);
    }
    try {
      await this.api.post(`/devices/commands/${cmd.id}/result`, outcome);
    } catch {
      this.outbox.enqueue(SyncEventType.COMMAND_RESULT, { commandId: cmd.id, success: outcome.success, result: outcome.result });
    }
  }
}
