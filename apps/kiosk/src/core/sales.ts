/**
 * Sales orchestration on the kiosk:
 *   order lock (server-authoritative; local pricing only when offline)
 *   → payment journal row written BEFORE the card reader is used
 *   → terminal result → reported to the server, or queued in the outbox if unreachable.
 * Rules: UNKNOWN is never shown as success; a PAID result is never dropped; no retry while UNKNOWN.
 */
import { randomUUID } from 'node:crypto';
import {
  ItemType,
  OrderKind,
  OrderStatus,
  PaymentResultSource,
  RenewalPolicy,
  SyncEventType,
  TerminalOutcome,
  computePeriod,
  maskMobile,
  normalizeMobile,
  priceItems,
  type Bootstrap,
  type OfflineOrderLine,
  type OrderDto,
  type OrderItemDto,
  type PaymentResultResponse,
  type PricingItem,
  type ReceiptData,
} from '@andishkadeh/shared';
import { generateQrToken, hashQrToken } from '@andishkadeh/shared/node';
import { ApiClient, ApiResponseError, NetworkError } from './api-client';
import type { CatalogStore } from './catalog';
import type { KioskConfig } from './config';
import { type Db, nextCounter } from './db';
import type { PaymentAdapter, PrinterAdapter, TerminalResult } from './hardware/types';
import type { Outbox } from './outbox';
import type { CreateOrderInput, CreateOrderResult, LocalOrderView, PaymentOutcomeView, PaymentStartResult, PrintResult } from './types';

interface OrderPayload {
  items: OrderItemDto[];
  lines: OfflineOrderLine[] | null;
  subtotal: number;
  discountTotal: number;
  total: number;
  priceChanged: boolean;
  activeCoverageUntil: string | null;
  periodPreview: LocalOrderView['periodPreview'];
  subscription: LocalOrderView['subscription'];
  planDurationDays: number | null;
  catalogRevision: number;
  paidAt: string | null;
  terminalRef: string | null;
  rrn: string | null;
}

interface OrderRow {
  local_id: string;
  server_id: string | null;
  order_number: string;
  kind: OrderKind;
  status: OrderStatus;
  offline: number;
  mobile: string;
  payload: string;
  qr_token: string | null;
  qr_token_hash: string | null;
  offline_enqueued: number;
  sync_pending: number;
  created_at: string;
}

interface JournalRow {
  attempt_id: string;
  local_order_id: string;
  amount: number;
  state: 'IN_FLIGHT' | TerminalOutcome;
  terminal_ref: string | null;
  rrn: string | null;
  trace_no: string | null;
  message: string | null;
  inquiries: number;
  started_at: string;
}

const OUTCOME_MESSAGE: Record<TerminalOutcome, string> = {
  PAID: 'پرداخت با موفقیت انجام شد',
  FAILED: 'پرداخت انجام نشد',
  CANCELLED: 'پرداخت در کارتخوان لغو شد',
  UNKNOWN: 'نتیجه پرداخت هنوز مشخص نیست',
};

export class SalesService {
  /** Attempts currently on the card reader in this process (never recovered while active). */
  private readonly active = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly api: ApiClient,
    private readonly catalog: CatalogStore,
    private readonly outbox: Outbox,
    private readonly payment: PaymentAdapter,
    private readonly printer: PrinterAdapter,
    private readonly cfg: KioskConfig,
    private readonly onChange: () => void,
  ) {}

  // ------------------------------------------------------------------ helpers

  private row(localId: string): OrderRow | undefined {
    return this.db.prepare('SELECT * FROM local_orders WHERE local_id = ?').get(localId) as OrderRow | undefined;
  }

  private payloadOf(row: OrderRow): OrderPayload {
    return JSON.parse(row.payload) as OrderPayload;
  }

  private save(row: Omit<OrderRow, 'payload'> & { payload: OrderPayload }) {
    this.db
      .prepare(
        `INSERT INTO local_orders (local_id, server_id, order_number, kind, status, offline, mobile, payload, qr_token, qr_token_hash, offline_enqueued, sync_pending, created_at, updated_at)
         VALUES (@local_id, @server_id, @order_number, @kind, @status, @offline, @mobile, @payload, @qr_token, @qr_token_hash, @offline_enqueued, @sync_pending, @created_at, @updated_at)
         ON CONFLICT(local_id) DO UPDATE SET server_id = excluded.server_id, order_number = excluded.order_number, status = excluded.status,
           payload = excluded.payload, qr_token = excluded.qr_token, offline_enqueued = excluded.offline_enqueued,
           sync_pending = excluded.sync_pending, updated_at = excluded.updated_at`,
      )
      .run({ ...row, payload: JSON.stringify(row.payload), updated_at: new Date().toISOString() });
  }

  private update(localId: string, patch: Partial<Omit<OrderRow, 'payload'>> & { payload?: Partial<OrderPayload> }) {
    const row = this.row(localId);
    if (!row) return;
    const payload = { ...this.payloadOf(row), ...(patch.payload ?? {}) };
    this.save({ ...row, ...patch, payload } as Omit<OrderRow, 'payload'> & { payload: OrderPayload });
  }

  view(localId: string): LocalOrderView | null {
    const row = this.row(localId);
    if (!row) return null;
    const p = this.payloadOf(row);
    return {
      localOrderId: row.local_id,
      serverOrderId: row.server_id,
      orderNumber: row.order_number,
      kind: row.kind,
      status: row.status,
      offline: row.offline === 1,
      mobileMasked: maskMobile(row.mobile),
      items: p.items,
      subtotal: p.subtotal,
      discountTotal: p.discountTotal,
      total: p.total,
      priceChanged: p.priceChanged,
      activeCoverageUntil: p.activeCoverageUntil,
      periodPreview: p.periodPreview,
      subscription: p.subscription,
      // The QR is only ever revealed after a confirmed payment (PRD K18).
      qrToken: row.status === OrderStatus.PAID ? row.qr_token : null,
      syncPending: row.sync_pending === 1,
      createdAt: row.created_at,
    };
  }

  private settings() {
    return this.catalog.current?.settings ?? null;
  }

  private journalFor(localId: string): JournalRow[] {
    return this.db.prepare('SELECT * FROM payment_journal WHERE local_order_id = ? ORDER BY started_at').all(localId) as JournalRow[];
  }

  unresolvedCount(): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM payment_journal WHERE state IN ('IN_FLIGHT', 'UNKNOWN')").get() as { n: number };
    return r.n;
  }

  // ------------------------------------------------------------------ order

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const mobile = normalizeMobile(input.mobile);
    if (!mobile) return { ok: false, code: 'INVALID_MOBILE', message: 'شماره موبایل معتبر نیست' };
    const bootstrap = this.catalog.current;
    if (!bootstrap) return { ok: false, code: 'NO_CATALOG', message: 'اطلاعات خدمات هنوز دریافت نشده است' };

    const localOrderId = randomUUID();
    const qrToken = input.kind === OrderKind.SUBSCRIPTION ? generateQrToken() : null;
    const qrHash = qrToken ? hashQrToken(qrToken) : null;

    try {
      const dto = await this.api.post<OrderDto>('/orders', {
        localOrderId,
        idempotencyKey: localOrderId,
        kind: input.kind,
        mobile,
        items: input.items,
        expectedTotal: input.expectedTotal,
        qrTokenHash: qrHash ?? undefined,
      });
      const plan = input.kind === OrderKind.SUBSCRIPTION ? bootstrap.plans.find((p) => p.id === input.items[0]?.itemId) : undefined;
      this.save({
        local_id: localOrderId,
        server_id: dto.id,
        order_number: dto.orderNumber,
        kind: dto.kind,
        status: dto.status,
        offline: 0,
        mobile,
        qr_token: qrToken,
        qr_token_hash: qrHash,
        offline_enqueued: 0,
        sync_pending: 0,
        created_at: dto.createdAt,
        payload: {
          items: dto.items,
          lines: null,
          subtotal: dto.subtotal,
          discountTotal: dto.discountTotal,
          total: dto.total,
          priceChanged: dto.priceChanged ?? false,
          activeCoverageUntil: dto.activeCoverageUntil ?? null,
          periodPreview: dto.periodPreview ?? null,
          subscription: dto.subscription ?? null,
          planDurationDays: plan?.durationDays ?? null,
          catalogRevision: bootstrap.catalogRevision,
          paidAt: dto.paidAt,
          terminalRef: null,
          rrn: null,
        },
      });
      return { ok: true, order: this.view(localOrderId)! };
    } catch (e) {
      if (e instanceof ApiResponseError && e.status < 500) {
        const unavailable = (e.details as { unavailable?: string[] } | undefined)?.unavailable;
        return { ok: false, code: e.code, message: e.message, unavailable };
      }
      if (!(e instanceof NetworkError) && !(e instanceof ApiResponseError)) throw e;
    }
    return this.createOfflineOrder(bootstrap, input, mobile, localOrderId, qrToken, qrHash);
  }

  private createOfflineOrder(
    bootstrap: Bootstrap,
    input: CreateOrderInput,
    mobile: string,
    localOrderId: string,
    qrToken: string | null,
    qrHash: string | null,
  ): CreateOrderResult {
    const s = bootstrap.settings;
    if (!s.offlineSalesEnabled) {
      return { ok: false, code: 'OFFLINE', message: 'ارتباط با سرور برقرار نیست و فروش آفلاین غیرفعال است' };
    }
    if (input.kind === OrderKind.SUBSCRIPTION && !s.offlineSubscriptionSales) {
      return {
        ok: false,
        code: 'OFFLINE_SUBSCRIPTION_DISABLED',
        message: 'خرید اشتراک در زمان قطع ارتباط امکان‌پذیر نیست؛ لطفاً کمی بعد دوباره تلاش کنید یا به پذیرش مراجعه کنید',
      };
    }
    const age = this.catalog.ageHours();
    if (age === null || age > s.offlineCatalogMaxAgeHours) {
      return { ok: false, code: 'CATALOG_STALE', message: 'اطلاعات قیمت‌ها به‌روز نیست؛ تا برقراری ارتباط با سرور فروش امکان‌پذیر نیست' };
    }

    const items: PricingItem[] = [];
    const unavailable: string[] = [];
    let planDurationDays: number | null = null;
    for (const it of input.items) {
      if (it.itemType === ItemType.PLAN) {
        const plan = bootstrap.plans.find((p) => p.id === it.itemId);
        if (!plan) {
          unavailable.push(it.itemId);
          continue;
        }
        planDurationDays = plan.durationDays;
        items.push({ itemType: ItemType.PLAN, itemId: plan.id, code: plan.code, title: plan.title, unit: 'اشتراک', unitPrice: plan.price, quantity: 1 });
        continue;
      }
      let found: PricingItem | null = null;
      for (const c of bootstrap.categories) {
        if (!c.salesEnabled) continue;
        for (const sc of c.subcategories) {
          const svc = sc.services.find((x) => x.id === it.itemId);
          if (svc) {
            found = {
              itemType: ItemType.SERVICE,
              itemId: svc.id,
              code: svc.code,
              title: svc.title,
              unit: svc.unit,
              unitPrice: svc.price,
              quantity: Math.min(it.quantity, s.maxItemQuantity),
              categoryId: c.id,
              categoryTitle: c.title,
              subcategoryId: sc.id,
            };
          }
        }
      }
      if (found) items.push(found);
      else unavailable.push(it.itemId);
    }
    if (unavailable.length) {
      return { ok: false, code: 'ITEM_UNAVAILABLE', message: 'برخی خدمات سبد دیگر قابل خرید نیستند', unavailable };
    }

    const now = new Date();
    const priced = priceItems(items, bootstrap.discounts, now, s.discountPolicy);
    const seq = nextCounter(this.db, 'offlineOrder');
    const orderNumber = `OFF-${this.cfg.deviceId}-${String(seq).padStart(5, '0')}`;
    const lines: OfflineOrderLine[] = priced.lines.map((l) => ({
      itemType: l.itemType,
      itemId: l.itemId,
      code: l.code,
      title: l.title,
      unit: l.unit,
      categoryId: l.categoryId ?? null,
      categoryTitle: l.categoryTitle ?? null,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      discountId: l.discountId,
      discountTitle: l.discountTitle,
      unitDiscount: l.unitDiscount,
      lineTotal: l.lineTotal,
    }));
    // Offline we can not see the member's existing coverage; the server recomputes dates on sync.
    const preview = planDurationDays ? computePeriod(now, planDurationDays, [], s.renewalPolicy as RenewalPolicy) : null;
    this.save({
      local_id: localOrderId,
      server_id: null,
      order_number: orderNumber,
      kind: input.kind,
      status: OrderStatus.LOCKED,
      offline: 1,
      mobile,
      qr_token: qrToken,
      qr_token_hash: qrHash,
      offline_enqueued: 0,
      sync_pending: 0,
      created_at: now.toISOString(),
      payload: {
        items: lines.map((l) => ({
          itemType: l.itemType,
          itemId: l.itemId,
          code: l.code,
          title: l.title,
          unit: l.unit,
          categoryTitle: l.categoryTitle,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          unitDiscount: l.unitDiscount,
          discountTitle: l.discountTitle,
          lineTotal: l.lineTotal,
        })),
        lines,
        subtotal: priced.subtotal,
        discountTotal: priced.discountTotal,
        total: priced.total,
        priceChanged: input.expectedTotal !== undefined && input.expectedTotal !== priced.total,
        activeCoverageUntil: null,
        periodPreview: preview
          ? { startsAt: preview.startsAt.toISOString(), expiresAt: preview.expiresAt.toISOString(), extended: false }
          : null,
        subscription: null,
        planDurationDays,
        catalogRevision: bootstrap.catalogRevision,
        paidAt: null,
        terminalRef: null,
        rrn: null,
      },
    });
    return { ok: true, order: this.view(localOrderId)! };
  }

  async cancelOrder(localId: string): Promise<{ ok: boolean }> {
    const row = this.row(localId);
    if (!row) return { ok: false };
    const open = this.journalFor(localId).some((j) => j.state === 'IN_FLIGHT' || j.state === TerminalOutcome.UNKNOWN);
    // Cancelling is free before payment; never while a payment is in flight or unresolved (PRD K24).
    if (open || row.status === OrderStatus.PAID) return { ok: false };
    this.update(localId, { status: OrderStatus.CANCELLED });
    if (row.server_id) {
      await this.api.post(`/orders/${row.server_id}/cancel`).catch(() => undefined);
    }
    return { ok: true };
  }

  // ------------------------------------------------------------------ payment

  async startPayment(localId: string): Promise<PaymentStartResult> {
    const row = this.row(localId);
    if (!row) return { ok: false, code: 'NOT_FOUND', message: 'سفارش یافت نشد' };
    if (row.status === OrderStatus.PAID) return { ok: true, result: this.outcomeView(localId, TerminalOutcome.PAID) };
    if (row.status !== OrderStatus.LOCKED && row.status !== OrderStatus.FAILED) {
      return { ok: false, code: 'ORDER_NOT_PAYABLE', message: 'این سفارش در وضعیت قابل پرداخت نیست' };
    }
    if (this.journalFor(localId).some((j) => j.state === 'IN_FLIGHT' || j.state === TerminalOutcome.UNKNOWN)) {
      return { ok: false, code: 'PAYMENT_UNRESOLVED', message: 'نتیجه پرداخت قبلی هنوز مشخص نیست؛ ابتدا استعلام لازم است' };
    }
    const posStatus = await this.payment.status();
    if (this.payment.name === 'not-configured') {
      return { ok: false, code: 'POS_NOT_CONFIGURED', message: posStatus.detail ?? 'کارتخوان در دسترس نیست' };
    }

    const p = this.payloadOf(row);
    const attemptId = randomUUID();
    // 1) Journal first: if power is lost while the card is on the reader, we know an attempt existed.
    this.db
      .prepare("INSERT INTO payment_journal (attempt_id, local_order_id, amount, state, started_at) VALUES (?, ?, ?, 'IN_FLIGHT', ?)")
      .run(attemptId, localId, p.total, new Date().toISOString());
    this.active.add(attemptId);
    this.update(localId, { status: OrderStatus.PAYMENT_PENDING });

    try {
      // 2) Make sure the server can attach the result to an order.
      if (row.offline === 1 && row.offline_enqueued === 0) {
        this.outbox.enqueue(SyncEventType.ORDER_OFFLINE, {
          localOrderId: row.local_id,
          orderNumber: row.order_number,
          kind: row.kind,
          mobile: row.mobile,
          createdAt: row.created_at,
          lines: p.lines ?? [],
          subtotal: p.subtotal,
          discountTotal: p.discountTotal,
          total: p.total,
          qrTokenHash: row.qr_token_hash,
          catalogRevision: p.catalogRevision,
        });
        this.update(localId, { offline_enqueued: 1 });
      } else if (row.server_id) {
        try {
          await this.api.post('/payments/initiate', { orderId: row.server_id, paymentAttemptId: attemptId, idempotencyKey: attemptId });
        } catch (e) {
          if (e instanceof ApiResponseError && e.status < 500) {
            // The server refused (already paid / another attempt unresolved): the card reader was never used.
            this.db.prepare('DELETE FROM payment_journal WHERE attempt_id = ?').run(attemptId);
            this.update(localId, { status: row.status });
            return { ok: false, code: e.code, message: e.message };
          }
          // Network problem: the card reader works without the server; the result will be synced.
        }
      }

      // 3) Card reader.
      const timeoutMs = (this.settings()?.paymentTimeoutSec ?? 120) * 1000;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let result: TerminalResult;
      try {
        result = await this.payment.initiate({ amount: p.total, orderRef: row.order_number, attemptId }, ctrl.signal);
      } catch (e) {
        result = { outcome: TerminalOutcome.UNKNOWN, terminalRef: null, rrn: null, traceNo: null, message: (e as Error).message };
      } finally {
        clearTimeout(timer);
      }
      if (ctrl.signal.aborted && result.outcome !== TerminalOutcome.PAID) {
        result = { ...result, outcome: TerminalOutcome.UNKNOWN, message: 'مهلت پاسخ کارتخوان تمام شد' };
      }
      // 4) Record + report.
      return { ok: true, result: await this.recordResult(localId, attemptId, result, PaymentResultSource.TERMINAL) };
    } finally {
      this.active.delete(attemptId);
      this.onChange();
    }
  }

  /** Persists a terminal/inquiry result and reports it (directly, or via the outbox when offline). */
  private async recordResult(localId: string, attemptId: string, result: TerminalResult, source: PaymentResultSource): Promise<PaymentOutcomeView> {
    const now = new Date().toISOString();
    const final = result.outcome !== TerminalOutcome.UNKNOWN;
    this.db
      .prepare(
        'UPDATE payment_journal SET state = ?, terminal_ref = COALESCE(?, terminal_ref), rrn = COALESCE(?, rrn), trace_no = COALESCE(?, trace_no), message = ?, source = ?, resolved_at = ? WHERE attempt_id = ?',
      )
      .run(result.outcome, result.terminalRef, result.rrn, result.traceNo, result.message, source, final ? now : null, attemptId);
    const journal = this.db.prepare('SELECT * FROM payment_journal WHERE attempt_id = ?').get(attemptId) as JournalRow;
    const row = this.row(localId)!;
    const p = this.payloadOf(row);

    const localStatus =
      result.outcome === TerminalOutcome.PAID
        ? OrderStatus.PAID
        : result.outcome === TerminalOutcome.UNKNOWN
          ? OrderStatus.UNKNOWN
          : OrderStatus.FAILED;
    const report = {
      outcome: result.outcome,
      amount: journal.amount,
      terminalRef: journal.terminal_ref,
      rrn: journal.rrn,
      traceNo: journal.trace_no,
      message: result.message,
      source,
      occurredAt: now,
    };

    let synced = false;
    if (row.server_id) {
      try {
        const res = await this.api.post<PaymentResultResponse>(`/payments/${attemptId}/result`, report);
        this.applyServerOrder(localId, res.order);
        synced = true;
      } catch {
        // Fall through to the outbox: the server will create/resolve the attempt on sync.
      }
    }
    if (!synced) {
      this.outbox.enqueue(SyncEventType.PAYMENT_RESULT, {
        paymentAttemptId: attemptId,
        localOrderId: localId,
        ...report,
        terminalRef: report.terminalRef ?? null,
        rrn: report.rrn ?? null,
        traceNo: report.traceNo ?? null,
        message: report.message ?? null,
      });
      const fresh = this.row(localId)!;
      // Never downgrade a confirmed PAID order.
      const status = fresh.status === OrderStatus.PAID ? OrderStatus.PAID : localStatus;
      this.update(localId, {
        status,
        sync_pending: 1,
        payload: {
          paidAt: status === OrderStatus.PAID ? (p.paidAt ?? now) : p.paidAt,
          terminalRef: journal.terminal_ref,
          rrn: journal.rrn,
          ...(status === OrderStatus.PAID && row.kind === OrderKind.SUBSCRIPTION && !p.subscription
            ? { subscription: this.provisionalPeriod(p, new Date(now)) }
            : {}),
        },
      });
    } else {
      this.update(localId, { payload: { terminalRef: journal.terminal_ref, rrn: journal.rrn } });
    }
    return this.outcomeView(localId, result.outcome, result.message);
  }

  /**
   * Period shown when the payment is confirmed by the card reader but not yet by the server.
   * The server recomputes it on sync (renewals may start later); the QR stays valid either way.
   */
  private provisionalPeriod(p: OrderPayload, paidAt: Date): NonNullable<LocalOrderView['subscription']> {
    const days = p.planDurationDays ?? 30;
    if (p.periodPreview?.extended) {
      return { planTitle: p.items[0]?.title ?? '', startsAt: p.periodPreview.startsAt, expiresAt: p.periodPreview.expiresAt, extended: true };
    }
    const period = computePeriod(paidAt, days, [], RenewalPolicy.START_NOW);
    return { planTitle: p.items[0]?.title ?? '', startsAt: period.startsAt.toISOString(), expiresAt: period.expiresAt.toISOString(), extended: false };
  }

  /** Server confirmation of an order (direct response or sync result). */
  applyServerOrder(localId: string, dto: OrderDto) {
    const row = this.row(localId);
    if (!row) return;
    this.update(localId, {
      server_id: dto.id,
      order_number: dto.orderNumber,
      status: dto.status,
      sync_pending: 0,
      payload: { subscription: dto.subscription ?? null, paidAt: dto.paidAt, items: dto.items, total: dto.total, subtotal: dto.subtotal, discountTotal: dto.discountTotal },
    });
  }

  private outcomeView(localId: string, outcome: TerminalOutcome, terminalMessage?: string | null): PaymentOutcomeView {
    const order = this.view(localId)!;
    const effective = order.status === OrderStatus.PAID ? TerminalOutcome.PAID : outcome;
    const detail = effective === TerminalOutcome.FAILED && terminalMessage ? ` (${terminalMessage})` : '';
    return {
      outcome: effective,
      message: OUTCOME_MESSAGE[effective] + detail,
      order,
      canRetry: effective === TerminalOutcome.FAILED || effective === TerminalOutcome.CANCELLED,
    };
  }

  /** K17 "استعلام مجدد": ask the terminal/bank about the unresolved attempt of this order. */
  async inquire(localId: string): Promise<PaymentStartResult> {
    const row = this.row(localId);
    if (!row) return { ok: false, code: 'NOT_FOUND', message: 'سفارش یافت نشد' };
    if (row.status === OrderStatus.PAID) return { ok: true, result: this.outcomeView(localId, TerminalOutcome.PAID) };
    const open = this.journalFor(localId).filter((j) => j.state === TerminalOutcome.UNKNOWN || (j.state === 'IN_FLIGHT' && !this.active.has(j.attempt_id)));
    const j = open[open.length - 1];
    if (!j) {
      const last = this.journalFor(localId).at(-1);
      return { ok: true, result: this.outcomeView(localId, (last?.state as TerminalOutcome) ?? TerminalOutcome.FAILED) };
    }
    return { ok: true, result: await this.resolveByInquiry(j, PaymentResultSource.INQUIRY) };
  }

  private async resolveByInquiry(j: JournalRow, source: PaymentResultSource): Promise<PaymentOutcomeView> {
    this.db.prepare('UPDATE payment_journal SET inquiries = inquiries + 1 WHERE attempt_id = ?').run(j.attempt_id);
    let result: TerminalResult;
    try {
      result = await this.payment.inquire({ attemptId: j.attempt_id, terminalRef: j.terminal_ref, amount: j.amount });
    } catch (e) {
      result = { outcome: TerminalOutcome.UNKNOWN, terminalRef: null, rrn: null, traceNo: null, message: (e as Error).message };
    }
    if (result.outcome === TerminalOutcome.UNKNOWN) {
      if (j.state === 'IN_FLIGHT') return this.recordResult(j.local_order_id, j.attempt_id, result, PaymentResultSource.RECOVERY);
      return this.outcomeView(j.local_order_id, TerminalOutcome.UNKNOWN);
    }
    const out = await this.recordResult(j.local_order_id, j.attempt_id, result, source);
    this.onChange();
    return out;
  }

  /**
   * Journal recovery (power cut, crash, network drop): runs at startup and periodically.
   * IN_FLIGHT rows not owned by this process are turned into UNKNOWN and re-queried.
   */
  async recover(maxInquiries = 30): Promise<number> {
    const rows = this.db
      .prepare("SELECT * FROM payment_journal WHERE state IN ('IN_FLIGHT', 'UNKNOWN') AND inquiries < ? ORDER BY started_at")
      .all(maxInquiries) as JournalRow[];
    let resolved = 0;
    for (const j of rows) {
      if (this.active.has(j.attempt_id)) continue;
      const out = await this.resolveByInquiry(j, PaymentResultSource.RECOVERY);
      if (out.outcome !== TerminalOutcome.UNKNOWN) resolved++;
    }
    return resolved;
  }

  /** Device command PAYMENT_INQUIRY from the admin panel. */
  async inquireByAttempt(attemptId: string, terminalRef: string | null, amount: number): Promise<TerminalResult> {
    const j = this.db.prepare('SELECT * FROM payment_journal WHERE attempt_id = ?').get(attemptId) as JournalRow | undefined;
    if (j) {
      const out = await this.resolveByInquiry(j, PaymentResultSource.INQUIRY);
      return { outcome: out.outcome, terminalRef: j.terminal_ref, rrn: j.rrn, traceNo: j.trace_no, message: out.message };
    }
    return this.payment.inquire({ attemptId, terminalRef, amount });
  }

  // ------------------------------------------------------------------ receipt

  buildReceipt(localId: string, reprint = false): ReceiptData | null {
    const row = this.row(localId);
    const s = this.settings();
    if (!row || !s) return null;
    const p = this.payloadOf(row);
    return {
      centerName: s.centerName,
      header: s.receiptHeader,
      footer: s.receiptFooter,
      orderNumber: row.order_number,
      offline: row.offline === 1 && row.sync_pending === 1,
      kind: row.kind,
      createdAt: row.created_at,
      paidAt: p.paidAt,
      mobileMasked: maskMobile(row.mobile),
      lines: p.items.map((i) => ({ code: i.code, title: i.title, quantity: i.quantity, unitPrice: i.unitPrice, unitDiscount: i.unitDiscount, lineTotal: i.lineTotal })),
      subtotal: p.subtotal,
      discountTotal: p.discountTotal,
      total: p.total,
      payment: { terminalRef: p.terminalRef, rrn: p.rrn },
      subscription: p.subscription
        ? { planTitle: p.subscription.planTitle, startsAt: p.subscription.startsAt, expiresAt: p.subscription.expiresAt, qrToken: reprint ? null : row.qr_token }
        : null,
      reprint,
      timezone: s.timezone,
    };
  }

  async printReceipt(localId: string): Promise<PrintResult> {
    const row = this.row(localId);
    if (!row || row.status !== OrderStatus.PAID) return { printed: false, detail: 'رسید فقط برای پرداخت موفق صادر می‌شود' };
    const receipt = this.buildReceipt(localId);
    if (!receipt) return { printed: false, detail: 'اطلاعات رسید کامل نیست' };
    let res: { ok: boolean; detail: string | null };
    try {
      res = await this.printer.print(receipt);
    } catch (e) {
      res = { ok: false, detail: (e as Error).message };
    }
    // Print failure never touches the order or payment (PRD §19); it is reported for admin reprint.
    this.outbox.enqueue(SyncEventType.RECEIPT_PRINT, { localOrderId: localId, printed: res.ok, detail: res.detail, at: new Date().toISOString() });
    this.onChange();
    return { printed: res.ok, detail: res.detail };
  }

  // ------------------------------------------------------------------ session

  /** End of session: personal data leaves the UI; raw QR tokens are wiped (only hashes remain). */
  endSession() {
    this.db
      .prepare(
        "UPDATE local_orders SET qr_token = NULL WHERE qr_token IS NOT NULL AND local_id NOT IN (SELECT local_order_id FROM payment_journal WHERE state = 'IN_FLIGHT')",
      )
      .run();
    // Mobile numbers are kept only until the order reached the outbox (offline) or the server.
    const rows = this.db.prepare("SELECT local_id, mobile FROM local_orders WHERE mobile NOT LIKE '%*%' AND (server_id IS NOT NULL OR offline_enqueued = 1 OR status = 'CANCELLED')").all() as Array<{ local_id: string; mobile: string }>;
    const stmt = this.db.prepare('UPDATE local_orders SET mobile = ? WHERE local_id = ?');
    for (const r of rows) stmt.run(maskMobile(r.mobile), r.local_id);
  }
}
