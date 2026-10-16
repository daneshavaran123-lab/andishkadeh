import { useEffect, useRef, useState } from 'react';
import {
  ItemType,
  OrderKind,
  formatJalaliLong,
  formatToman,
  maskMobile,
  normalizeMobile,
  toPersianDigits,
} from '@andishkadeh/shared';
import { invoke } from '../bridge';
import { Icon } from '../components/Icon';
import { Notice, NumPad, Screen, Spinner } from '../components/ui';
import { cartPreview, planPrice, sessionGuard, useAllowIdleTimeout, useApp, useSession } from '../store';
import type { CreateOrderResult, PaymentStartResult, PrintResult } from '../../core/types';

const fmtMobile = (digits: string) => {
  const d = digits.padEnd(0);
  const parts = [d.slice(0, 4), d.slice(4, 7), d.slice(7, 11)].filter(Boolean);
  return toPersianDigits(parts.join(' '));
};

/** K13 — mobile number with numeric keypad, Persian digits normalised, 09xxxxxxxxx validated. */
export function Mobile() {
  const { mobile, set, go } = useSession();
  const [digits, setDigits] = useState(mobile);
  const [touched, setTouched] = useState(false);
  const valid = normalizeMobile(digits) !== null;
  const error = touched && digits.length === 11 && !valid;
  const hint =
    digits.length > 0 && !digits.startsWith('0')
      ? 'شماره موبایل باید با ۰۹ شروع شود'
      : error
        ? 'شماره موبایل معتبر نیست'
        : 'شماره موبایل ۱۱ رقمی، مثال: ۰۹۱۲۳۴۵۶۷۸۹';

  return (
    <Screen
      title="شماره موبایل"
      subtitle="برای ثبت سفارش و رسید؛ کد تأیید ارسال نمی‌شود"
      footer={
        <button
          className="btn btn-primary btn-block"
          disabled={!valid}
          onClick={() => {
            set({ mobile: normalizeMobile(digits)! });
            go('review');
          }}
          data-testid="mobile-confirm"
        >
          تأیید و ادامه
          <Icon name="chevron" />
        </button>
      }
    >
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
        <span className="icon-ring" style={{ ['--theme' as string]: 'var(--blue)' }}>
          <Icon name="phone" />
        </span>
      </div>
      <div className={`mobile-display${valid ? ' valid' : ''}`} data-testid="mobile-display">
        {digits ? fmtMobile(digits) : <span className="ph">{toPersianDigits('09__ ___ ____')}</span>}
      </div>
      <div className={`field-msg${error || (digits.length > 0 && !digits.startsWith('0')) ? ' error' : ''}`}>{hint}</div>
      <NumPad
        onDigit={(d) => {
          setTouched(true);
          setDigits((v) => (v.length >= 11 ? v : v + d));
        }}
        onBackspace={() => setDigits((v) => v.slice(0, -1))}
        onClear={() => setDigits('')}
      />
    </Screen>
  );
}

/** K14 — final review: the order is created and price-locked on entry. */
export function Review() {
  const bootstrap = useApp((s) => s.bootstrap);
  const tz = bootstrap?.settings.timezone;
  const { flow, cart, planId, mobile, order, set, go, backTo, removeMany, showToast, reset } = useSession();
  const [state, setState] = useState<'locking' | 'ready' | 'error'>(order ? 'ready' : 'locking');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || order) return;
    started.current = true;
    const isSub = flow === OrderKind.SUBSCRIPTION;
    const plan = bootstrap?.plans.find((p) => p.id === planId);
    const items = isSub
      ? [{ itemType: ItemType.PLAN, itemId: planId!, quantity: 1 }]
      : cart.map((c) => ({ itemType: ItemType.SERVICE, itemId: c.serviceId, quantity: c.quantity }));
    const expectedTotal = isSub ? (bootstrap && plan ? planPrice(bootstrap, plan).finalPrice : undefined) : cartPreview(bootstrap, cart).total;
    const session = sessionGuard();
    void invoke('order:create', { kind: isSub ? OrderKind.SUBSCRIPTION : OrderKind.SERVICES, mobile, items, expectedTotal }).then((r: CreateOrderResult) => {
      if (!session.alive()) {
        // The customer left while the order was being locked: release it instead of showing it to the next one.
        if (r.ok) void invoke('order:cancel', { localOrderId: r.order.localOrderId }).catch(() => undefined);
        return;
      }
      if (r.ok) {
        set({ order: r.order });
        setState('ready');
        return;
      }
      if (r.code === 'ITEM_UNAVAILABLE' && r.unavailable?.length && !isSub) {
        removeMany(r.unavailable);
        showToast('برخی خدمات دیگر قابل خرید نیستند و از سبد حذف شدند');
        backTo('cart');
        return;
      }
      if (r.code === 'INVALID_MOBILE') {
        backTo('mobile');
        return;
      }
      setError({ code: r.code, message: r.message });
      setState('error');
    });
  }, []);

  const edit = async () => {
    if (order) await invoke('order:cancel', { localOrderId: order.localOrderId });
    set({ order: null });
    backTo(flow === OrderKind.SUBSCRIPTION ? 'planDetail' : 'cart');
  };

  if (state === 'locking') {
    return (
      <Screen title="تأیید نهایی" actions={false} onBack={null} calm center>
        <div className="result">
          <Spinner />
          <h2 style={{ fontSize: 40 }}>در حال ثبت سفارش و قفل مبلغ…</h2>
        </div>
      </Screen>
    );
  }

  if (state === 'error' || !order) {
    return (
      <Screen title="ثبت سفارش انجام نشد" onBack={() => backTo('home')} calm center>
        <div className="result">
          <span className="result-icon c-amber">
            <Icon name="alert" />
          </span>
          <h2>امکان ثبت سفارش نیست</h2>
          <p>{error?.message}</p>
          <button className="btn btn-ghost" onClick={reset}>
            بازگشت به صفحه شروع
          </button>
        </div>
      </Screen>
    );
  }

  const isSub = order.kind === OrderKind.SUBSCRIPTION;
  return (
    <Screen
      title="تأیید نهایی"
      subtitle="مبلغ زیر قفل شده و هنگام پرداخت تغییر نمی‌کند"
      onBack={edit}
      footer={
        <div className="footer-row">
          <button className="btn btn-ghost" onClick={edit} data-testid="edit-order" style={{ flex: '0 0 300px' }}>
            ویرایش
          </button>
          <button className="btn btn-success" onClick={() => go('paying')} data-testid="pay">
            <Icon name="card" />
            پرداخت با کارتخوان — {formatToman(order.total)}
          </button>
        </div>
      }
    >
      <div className="stack">
        {order.priceChanged && (
          <Notice tone="amber">قیمت برخی موارد از زمان انتخاب تغییر کرده است؛ مبلغ زیر بر اساس قیمت‌های روز مرکز به‌روز شد.</Notice>
        )}
        {order.offline && (
          <Notice tone="amber" icon="wifiOff">
            ارتباط با مرکز برقرار نیست. سفارش با کد موقت <span className="ltr">{order.orderNumber}</span> به‌صورت محلی ثبت می‌شود و پس از اتصال همگام‌سازی خواهد شد. پرداخت فقط با تأیید کارتخوان موفق محسوب می‌شود.
          </Notice>
        )}
        <div className="panel">
          <div className="kv">
            <span className="k">شماره موبایل</span>
            <span className="v ltr" data-testid="masked-mobile">{toPersianDigits(maskMobile(mobile))}</span>
          </div>
          <div className="kv">
            <span className="k">شماره سفارش</span>
            <span className="v ltr">{order.orderNumber}</span>
          </div>
        </div>
        <div className="panel">
          {order.items.map((it) => (
            <div className="kv" key={it.itemId} style={{ alignItems: 'flex-start', gap: 24 }}>
              <span className="k" style={{ color: 'var(--text)', lineHeight: 1.6 }}>
                {it.title}
                <span className="muted" style={{ display: 'block', fontSize: 20 }}>
                  <span className="code-chip">{it.code}</span> × {toPersianDigits(it.quantity)}
                  {it.discountTitle ? ` — ${it.discountTitle}` : ''}
                </span>
              </span>
              <span className="v" style={{ whiteSpace: 'nowrap' }}>{formatToman(it.lineTotal)}</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <div className="kv">
            <span className="k">جمع</span>
            <span className="v">{formatToman(order.subtotal)}</span>
          </div>
          {order.discountTotal > 0 && (
            <div className="kv discount">
              <span className="k">تخفیف</span>
              <span className="v">− {formatToman(order.discountTotal)}</span>
            </div>
          )}
          <div className="kv total">
            <span className="k">مبلغ قابل پرداخت</span>
            <span className="v" data-testid="locked-total">{formatToman(order.total)}</span>
          </div>
        </div>
        {isSub && order.periodPreview && (
          <div className="panel">
            <div className="kv">
              <span className="k">شروع اعتبار</span>
              <span className="v">{formatJalaliLong(order.periodPreview.startsAt, tz)}</span>
            </div>
            <div className="kv">
              <span className="k">پایان اعتبار</span>
              <span className="v">{formatJalaliLong(order.periodPreview.expiresAt, tz)}</span>
            </div>
          </div>
        )}
        {isSub && order.activeCoverageUntil && (
          <Notice tone="blue" icon="clock">
            شما اشتراک فعال تا {formatJalaliLong(order.activeCoverageUntil, tz)} دارید؛ اشتراک جدید از پایان آن شروع می‌شود.
          </Notice>
        )}
      </div>
    </Screen>
  );
}

/** Guard against duplicate starts (double tap, React re-mount): one payment per visit. */
const startedPayments = new Set<string>();

/** K15 — payment in progress. No back, no cancel, no decorative motion (PRD F-02). */
export function Paying() {
  const { order, set, replace } = useSession();
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const visit = useRef(`${order?.localOrderId}:${Date.now()}`);

  useEffect(() => {
    if (!order || startedPayments.has(visit.current)) return;
    startedPayments.add(visit.current);
    const session = sessionGuard();
    void invoke('payment:start', { localOrderId: order.localOrderId }).then((r: PaymentStartResult) => {
      if (!session.alive()) return; // the result is recorded by the core either way
      if (r.ok) {
        set({ payment: r.result, order: r.result.order, inquiredOnce: false });
        replace('paymentResult');
      } else {
        setError(r);
      }
    });
  }, []);
  useAllowIdleTimeout(!!error);

  if (!order) return null;
  if (error) {
    return (
      <Screen title="پرداخت آغاز نشد" onBack={() => replace('review')} calm center>
        <div className="result">
          <span className="result-icon c-amber">
            <Icon name="alert" />
          </span>
          <h2>امکان شروع پرداخت نیست</h2>
          <p>{error.message}</p>
        </div>
      </Screen>
    );
  }
  return (
    <Screen title="پرداخت با کارتخوان" onBack={null} actions={false} calm center>
      <div className="result" data-testid="paying">
        <p style={{ fontSize: 28 }}>مبلغ قابل پرداخت</p>
        <div style={{ fontSize: 72, fontWeight: 900 }}>{formatToman(order.total)}</div>
        <div className="pos-visual">
          <Icon name="card" />
        </div>
        <h2 style={{ fontSize: 40 }}>کارت بانکی را در کارتخوان وارد کنید</h2>
        <p>سپس رمز کارت را روی کارتخوان وارد کنید. تا دریافت پاسخ، از این صفحه خارج نشوید.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 24 }}>
          <Spinner />
          <span style={{ fontSize: 26, color: 'var(--muted)' }}>در انتظار پاسخ کارتخوان…</span>
        </div>
      </div>
    </Screen>
  );
}

/** K16 / K17 / K21 — payment result. UNKNOWN is never presented as failure or success. */
export function PaymentResult() {
  const { payment, inquiredOnce, set, replace, go } = useSession();
  const [busy, setBusy] = useState(false);
  if (!payment) return null;
  const { order, outcome } = payment;
  const isSub = order.kind === OrderKind.SUBSCRIPTION;

  const inquire = async () => {
    setBusy(true);
    const session = sessionGuard();
    const r = await invoke('payment:inquire', { localOrderId: order.localOrderId });
    if (!session.alive()) return;
    setBusy(false);
    if (r.ok) set({ payment: r.result, order: r.result.order, inquiredOnce: true });
    else set({ inquiredOnce: true });
  };

  const abandon = async () => {
    await invoke('order:cancel', { localOrderId: order.localOrderId });
    replace('end', { reason: 'cancel' });
  };

  if (outcome === 'PAID') {
    return (
      <Screen
        title="پرداخت موفق"
        onBack={null}
        actions={false}
        calm
        center
        footer={
          isSub ? (
            <button className="btn btn-success btn-block" onClick={() => replace('activation')} data-testid="to-activation">
              <Icon name="qr" />
              دریافت کارت عضویت (QR)
            </button>
          ) : (
            <div className="footer-row">
              <button className="btn btn-ghost" onClick={() => replace('end')} data-testid="finish-no-print" style={{ flex: '0 0 320px' }}>
                پایان بدون رسید
              </button>
              <button className="btn btn-success" onClick={() => go('printing')} data-testid="print">
                <Icon name="printer" />
                چاپ رسید
              </button>
            </div>
          )
        }
      >
        <div className="result" data-testid="result-paid">
          <span className="result-icon c-green">
            <Icon name="check" />
          </span>
          <h2>پرداخت با موفقیت انجام شد</h2>
          <p>شماره سفارش</p>
          <span className="order-no" data-testid="order-number">{order.orderNumber}</span>
          <div style={{ fontSize: 44, fontWeight: 900 }}>{formatToman(order.total)}</div>
          {order.syncPending && (
            <Notice tone="amber" icon="wifiOff">
              ثبت محلی: پرداخت توسط کارتخوان تأیید شد. سفارش با کد بالا روی کیوسک ثبت شده و پس از برقراری ارتباط با مرکز همگام‌سازی می‌شود.
            </Notice>
          )}
        </div>
      </Screen>
    );
  }

  if (outcome === 'UNKNOWN') {
    return (
      <Screen
        title="وضعیت پرداخت نامشخص"
        onBack={null}
        actions={false}
        calm
        center
        footer={
          <div className="footer-row">
            <button className="btn btn-ghost" disabled={!inquiredOnce || busy} onClick={() => replace('end', { reason: 'unknown' })} data-testid="unknown-finish">
              پایان و مراجعه به پذیرش
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={inquire} data-testid="inquire">
              <Icon name="refresh" />
              {busy ? 'در حال استعلام…' : 'استعلام مجدد'}
            </button>
          </div>
        }
      >
        <div className="result" data-testid="result-unknown">
          <span className="result-icon c-amber">
            <Icon name="clock" />
          </span>
          <h2>نتیجه پرداخت هنوز مشخص نیست</h2>
          <p>
            پاسخ قطعی از کارتخوان دریافت نشد. سفارش شما ثبت شده است و وضعیت پرداخت از طریق استعلام تعیین می‌شود. اگر مبلغی از حساب شما کسر شده باشد، پس از تعیین وضعیت قطعی ثبت خواهد شد.
          </p>
          <p>شماره سفارش را نزد خود نگه دارید:</p>
          <span className="order-no">{order.orderNumber}</span>
          {busy && <Spinner />}
          {inquiredOnce && !busy && <Notice tone="amber">استعلام هنوز پاسخ قطعی نداده است. می‌توانید دوباره تلاش کنید یا با شماره سفارش به پذیرش مراجعه کنید.</Notice>}
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      title="پرداخت ناموفق"
      onBack={null}
      actions={false}
      calm
      center
      footer={
        <div className="footer-row">
          <button className="btn btn-ghost" onClick={abandon} data-testid="abandon">
            انصراف از خرید
          </button>
          <button className="btn btn-primary" onClick={() => replace('paying')} data-testid="retry">
            <Icon name="refresh" />
            تلاش مجدد
          </button>
        </div>
      }
    >
      <div className="result" data-testid="result-failed">
        <span className="result-icon c-red">
          <Icon name="x" />
        </span>
        <h2>پرداخت انجام نشد</h2>
        <p>{payment.message}</p>
        <p>تراکنش توسط کارتخوان تأیید نشد. می‌توانید دوباره تلاش کنید.</p>
      </div>
    </Screen>
  );
}

/** K22 — receipt printing. A failed print never cancels the order. */
export function Printing() {
  const { order, replace } = useSession();
  const [state, setState] = useState<'printing' | 'done' | 'failed'>('printing');
  const [detail, setDetail] = useState<string | null>(null);
  const run = useRef(0);

  const print = () => {
    if (!order) return;
    const id = ++run.current;
    setState('printing');
    const session = sessionGuard();
    void invoke('receipt:print', { localOrderId: order.localOrderId }).then((r: PrintResult) => {
      if (id !== run.current || !session.alive()) return;
      setDetail(r.detail);
      setState(r.printed ? 'done' : 'failed');
    });
  };

  useEffect(print, []);
  useAllowIdleTimeout(state === 'failed');
  useEffect(() => {
    if (state !== 'done') return;
    const t = setTimeout(() => replace('end'), 4000);
    return () => clearTimeout(t);
  }, [state]);

  if (!order) return null;
  return (
    <Screen
      title="چاپ رسید"
      onBack={null}
      actions={false}
      calm
      center
      footer={
        state === 'printing' ? undefined : (
          <div className="footer-row">
            {state === 'failed' && (
              <button className="btn btn-ghost" onClick={print} data-testid="reprint">
                <Icon name="refresh" />
                تلاش مجدد چاپ
              </button>
            )}
            <button className="btn btn-primary" onClick={() => replace('end')} data-testid="finish">
              پایان
            </button>
          </div>
        )
      }
    >
      <div className="result" data-testid={`print-${state}`}>
        {state === 'printing' && (
          <>
            <Spinner />
            <h2 style={{ fontSize: 44 }}>در حال چاپ رسید…</h2>
          </>
        )}
        {state === 'done' && (
          <>
            <span className="result-icon c-green">
              <Icon name="receipt" />
            </span>
            <h2>رسید چاپ شد</h2>
            <p>لطفاً رسید خود را از چاپگر بردارید.</p>
          </>
        )}
        {state === 'failed' && (
          <>
            <span className="result-icon c-amber">
              <Icon name="printer" />
            </span>
            <h2>چاپ رسید انجام نشد</h2>
            <p>{detail ?? 'چاپگر در دسترس نیست.'}</p>
            <p>خرید شما ثبت شده است. شماره سفارش را یادداشت کنید؛ رسید در پذیرش قابل چاپ مجدد است.</p>
            <span className="order-no">{order.orderNumber}</span>
          </>
        )}
      </div>
    </Screen>
  );
}

/** K23 — end of session: thanks, then automatic return to K01 with all personal data cleared. */
export function End({ reason }: { reason?: string }) {
  const reset = useSession((s) => s.reset);
  const seconds = useApp((s) => s.bootstrap?.settings.endScreenSec ?? 8);
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    void invoke('session:end');
    const t = setInterval(() => setLeft((v) => v - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) reset();
  }, [left]);

  const title = reason === 'cancel' ? 'خرید لغو شد' : reason === 'unknown' ? 'سفارش شما ثبت شده است' : 'از خرید شما سپاسگزاریم';
  const text =
    reason === 'unknown'
      ? 'وضعیت پرداخت پس از استعلام مشخص می‌شود. برای پیگیری با شماره سفارش به پذیرش مراجعه کنید.'
      : reason === 'cancel'
        ? 'هیچ مبلغی بابت این سفارش دریافت نشد.'
        : 'برای استفاده از خدمات با رسید خود به پذیرش مراجعه کنید.';
  return (
    <Screen onBack={null} actions={false} calm center>
      <div className="result" data-testid="end">
        <span className={`result-icon ${reason === 'unknown' ? 'c-amber' : 'c-blue'}`}>
          <Icon name={reason === 'unknown' ? 'clock' : 'check'} />
        </span>
        <h2>{title}</h2>
        <p>{text}</p>
        <p style={{ fontSize: 24 }}>بازگشت خودکار به صفحه شروع تا {toPersianDigits(Math.max(left, 0))} ثانیه دیگر</p>
        <button className="btn btn-ghost" onClick={reset} data-testid="end-now">
          <Icon name="home" />
          بازگشت به صفحه شروع
        </button>
      </div>
    </Screen>
  );
}
