/**
 * Kiosk core: composes local DB, API client, hardware adapters, sales, access and sync.
 * Platform independent (no Node or browser APIs here): hosted by the Electron main process,
 * by the page itself in the web app / Android app, or by the dev bridge (development and E2E).
 * Storage and printing are injected by the host — see src/platform/*.
 */
import { HardwareState, OrderKind } from '@andishkadeh/shared';
import { AccessService } from './access';
import { ApiClient } from './api-client';
import { CatalogStore } from './catalog';
import type { KioskConfig } from './config';
import { type Db, migrate } from './db';
import { Emitter } from './emitter';
import { MockPaymentAdapter, UnconfiguredPaymentAdapter } from './hardware/payment';
import { KeyboardWedgeScanner, MockPrinterAdapter, MockScanner } from './hardware/printer';
import type { MediaStore } from './media';
import type { PaymentAdapter, PrinterAdapter, ScannerAdapter } from './hardware/types';
import type { SqlDatabase } from './sql';
import { Outbox } from './outbox';
import { SalesService } from './sales';
import { SyncWorker } from './sync';
import type { AppState, DevControl, IpcChannel, IpcChannels, IpcEvent, IpcEvents, KioskStatus } from './types';

export interface CoreOptions {
  /** Base URL the UI uses to load cached media (`kiosk-media://media` in Electron). */
  mediaBase: string;
  /** Open local database (migrated by the core). */
  db: SqlDatabase;
  /** Storage for verified catalogue images. */
  media: MediaStore;
  /** Receipt printer of the platform (simulated, Windows driver, browser print…). */
  printer: PrinterAdapter;
  /** Card reader; defaults to the simulator or "not configured" according to cfg.adapters.payment. */
  payment?: PaymentAdapter;
}

export class KioskCore {
  readonly db: Db;
  readonly api: ApiClient;
  readonly catalog: CatalogStore;
  readonly outbox: Outbox;
  readonly payment: PaymentAdapter;
  readonly printer: PrinterAdapter;
  readonly scanner: ScannerAdapter;
  readonly sales: SalesService;
  readonly access: AccessService;
  readonly sync: SyncWorker;
  private readonly emitter = new Emitter<IpcEvents>();
  private online = false;
  private hardwareCache: KioskStatus['hardware'] | null = null;

  constructor(
    readonly cfg: KioskConfig,
    private readonly opts: CoreOptions,
  ) {
    this.db = migrate(opts.db);
    this.api = new ApiClient(cfg, (online) => {
      if (online !== this.online) {
        this.online = online;
        this.emitStatus();
      }
    });
    this.catalog = new CatalogStore(this.db, this.api, opts.media);
    this.outbox = new Outbox(this.db);
    this.payment = opts.payment ?? (cfg.adapters.payment === 'mock' ? new MockPaymentAdapter() : new UnconfiguredPaymentAdapter());
    this.printer = opts.printer;
    this.scanner = cfg.adapters.scanner === 'mock' ? new MockScanner() : new KeyboardWedgeScanner();
    this.sales = new SalesService(this.db, this.api, this.catalog, this.outbox, this.payment, this.printer, cfg, () => this.emitStatus());
    this.access = new AccessService(this.db, this.api, this.catalog, this.outbox);
    this.sync = new SyncWorker(this.db, this.api, cfg, this.catalog, this.outbox, this.sales, this.access, {
      payment: this.payment,
      printer: this.printer,
      scanner: this.scanner,
    }, {
      onCatalog: () => this.emit('catalog', this.appStateSync()),
      onStatus: () => this.emitStatus(),
    });
    this.scanner.onScan((payload) => this.emit('scanner:scan', { payload }));
  }

  start() {
    this.sync.start();
  }

  stop() {
    this.sync.stop();
    this.db.close();
  }

  /** Waits until pending writes are stored (web/Android driver); call before the page is closed. */
  flush(): Promise<void> {
    return this.db.flush();
  }

  on<E extends IpcEvent>(event: E, cb: (data: IpcEvents[E]) => void): () => void {
    return this.emitter.on(event, cb);
  }

  private emit<E extends IpcEvent>(event: E, data: IpcEvents[E]) {
    this.emitter.emit(event, data);
  }

  private async refreshHardware() {
    const [pos, printer, scanner] = await Promise.all([this.payment.status(), this.printer.status(), this.scanner.status()]);
    this.hardwareCache = { pos, printer, scanner };
  }

  private emitStatus() {
    void this.refreshHardware().then(() => this.emit('status', this.statusSync()));
  }

  statusSync(): KioskStatus {
    const b = this.catalog.current;
    const s = b?.settings;
    const age = this.catalog.ageHours();
    const fresh = age !== null && s ? age <= s.offlineCatalogMaxAgeHours : false;
    const posUsable = this.payment.name !== 'not-configured';
    const salesAvailable = !!b && posUsable && (this.online || (!!s?.offlineSalesEnabled && fresh));
    const unknown = { state: HardwareState.UNKNOWN, adapter: '-', detail: null };
    const stats = this.outbox.stats();
    return {
      deviceId: this.cfg.deviceId,
      appVersion: this.cfg.appVersion,
      online: this.online,
      catalogRevision: b?.catalogRevision ?? 0,
      catalogUpdatedAt: this.catalog.updatedAt,
      salesAvailable,
      subscriptionSalesAvailable: salesAvailable && (this.online || !!s?.offlineSubscriptionSales) && (b?.plans.length ?? 0) > 0,
      hardware: this.hardwareCache ?? { pos: unknown, printer: unknown, scanner: unknown },
      mockHardware: this.payment.isMock || this.printer.isMock || this.scanner.isMock,
      outbox: { pending: stats.pending, failed: stats.failed },
      unresolvedPayments: this.sales.unresolvedCount(),
      lastSyncAt: this.sync.lastSyncAt,
    };
  }

  private appStateSync(): AppState {
    return { bootstrap: this.catalog.current, status: this.statusSync(), mediaBase: this.opts.mediaBase };
  }

  /** Single entry point for every allowed IPC channel. Unknown channels are rejected. */
  async handle<C extends IpcChannel>(channel: C, req: IpcChannels[C]['req']): Promise<IpcChannels[C]['res']> {
    type R = IpcChannels[C]['res'];
    switch (channel) {
      case 'app:getState':
        await this.refreshHardware();
        return this.appStateSync() as R;
      case 'order:create': {
        const r = req as IpcChannels['order:create']['req'];
        if (r.kind !== OrderKind.SERVICES && r.kind !== OrderKind.SUBSCRIPTION) throw new Error('invalid kind');
        return (await this.sales.createOrder(r)) as R;
      }
      case 'order:cancel':
        return (await this.sales.cancelOrder((req as { localOrderId: string }).localOrderId)) as R;
      case 'payment:start': {
        const out = await this.sales.startPayment((req as { localOrderId: string }).localOrderId);
        void this.sync.push();
        return out as R;
      }
      case 'payment:inquire': {
        const out = await this.sales.inquire((req as { localOrderId: string }).localOrderId);
        void this.sync.push();
        return out as R;
      }
      case 'receipt:print': {
        const out = await this.sales.printReceipt((req as { localOrderId: string }).localOrderId);
        void this.sync.push();
        return out as R;
      }
      case 'access:validate': {
        const out = await this.access.validate((req as { token: string }).token);
        void this.sync.push();
        return out as R;
      }
      case 'session:end':
        this.sales.endSession();
        return { ok: true } as R;
      case 'dev:control':
        return (await this.devControl(req as DevControl)) as R;
      default:
        throw new Error(`channel not allowed: ${String(channel)}`);
    }
  }

  private async devControl(c: DevControl): Promise<{ ok: boolean; message?: string }> {
    if (!this.cfg.devControls) return { ok: false, message: 'dev controls disabled' };
    const pos = this.payment instanceof MockPaymentAdapter ? this.payment : null;
    const printer = this.printer instanceof MockPrinterAdapter ? this.printer : null;
    switch (c.action) {
      case 'posScenario':
        if (!pos) return { ok: false, message: 'POS is not simulated' };
        pos.scenario = c.scenario;
        break;
      case 'inquiryMode':
        if (!pos) return { ok: false, message: 'POS is not simulated' };
        pos.inquiryMode = c.mode;
        break;
      case 'printerMode':
        if (!printer) return { ok: false, message: 'printer is not simulated' };
        printer.mode = c.mode;
        break;
      case 'scannerMode':
        if (!(this.scanner instanceof MockScanner)) return { ok: false, message: 'scanner is not simulated' };
        this.scanner.mode = c.mode;
        break;
      case 'replayOutbox':
        this.outbox.replayDone();
        await this.sync.push();
        break;
      case 'scan':
        if (this.scanner instanceof MockScanner) this.scanner.emit(c.payload);
        else this.emit('scanner:scan', { payload: c.payload });
        break;
      case 'network':
        this.api.forcedOffline = !c.online;
        // Run a cycle either way so connectivity (and the UI banner) reflects the change at once.
        await this.sync.cycle().catch(() => undefined);
        break;
      case 'syncNow':
        await this.sync.cycle();
        break;
    }
    this.emitStatus();
    return { ok: true };
  }
}
