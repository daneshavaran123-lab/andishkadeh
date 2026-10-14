import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ORDER_KIND_LABEL,
  ORDER_STATUS_LABEL,
  OrderKind,
  OrderStatus,
  PAYMENT_SOURCE_LABEL,
  PAYMENT_STATUS_LABEL,
  PRINT_STATUS_LABEL,
  formatJalaliDate,
  formatJalaliDateTime,
  formatNumberFa,
  formatToman,
  type DeviceRow,
  type OrderDetail,
  type OrderRow,
  type ReceiptData,
} from '@andishkadeh/shared';
import { api, errorMessage, qs } from '../api';
import { AdminOnly } from '../auth';
import { Icon } from '../components/Icon';
import { Alert, Badge, Card, Code, DateRangeFilter, Empty, ErrorBox, Field, JDateTime, Loading, Modal, PageHead, Pagination, ReasonDialog, useToast, type RangePreset, type Tone } from '../components/ui';
import { PAYMENT_TONE } from './Dashboard';
import { PaymentActions } from './Payments';

export const ORDER_TONE: Record<OrderStatus, Tone> = {
  LOCKED: 'neutral',
  PAYMENT_PENDING: 'info',
  PAID: 'success',
  FAILED: 'danger',
  UNKNOWN: 'warning',
  CANCELLED: 'neutral',
};

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** A09 — order search and filters. */
export function Orders() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const [term, setTerm] = useState(sp.get('q') ?? '');
  const [range, setRange] = useState<{ preset: RangePreset; from: string; to: string } | null>(null);
  const page = Number(sp.get('page') ?? 1);
  const query = qs({
    page,
    pageSize: 25,
    q: sp.get('q'),
    status: sp.get('status'),
    kind: sp.get('kind'),
    conflict: sp.get('conflict'),
    offline: sp.get('offline'),
    from: range?.from,
    to: range?.to,
  });
  const q = useQuery({ queryKey: ['orders', query], queryFn: () => api.get<Page<OrderRow>>(`/admin/orders${query}`) });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n);
  };

  return (
    <>
      <PageHead title="سفارش‌ها" subtitle="جست‌وجو با شماره سفارش یا بخشی از شماره موبایل" />
      <div className="toolbar">
        <Field label="جست‌وجو">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              set('q', term.trim());
            }}
          >
            <input className="input" placeholder="AK-000123 یا ۰۹۱۲…" value={term} onChange={(e) => setTerm(e.target.value)} style={{ width: 240 }} data-testid="orders-search" />
          </form>
        </Field>
        <Field label="وضعیت">
          <select className="select" value={sp.get('status') ?? ''} onChange={(e) => set('status', e.target.value)} style={{ width: 150 }}>
            <option value="">همه</option>
            {Object.values(OrderStatus).map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="نوع">
          <select className="select" value={sp.get('kind') ?? ''} onChange={(e) => set('kind', e.target.value)} style={{ width: 140 }}>
            <option value="">همه</option>
            {Object.values(OrderKind).map((k) => (
              <option key={k} value={k}>
                {ORDER_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ویژگی">
          <select
            className="select"
            value={sp.get('conflict') ? 'conflict' : sp.get('offline') ? 'offline' : ''}
            onChange={(e) => {
              const n = new URLSearchParams(sp);
              n.delete('conflict');
              n.delete('offline');
              n.delete('page');
              if (e.target.value === 'conflict') n.set('conflict', 'true');
              if (e.target.value === 'offline') n.set('offline', 'true');
              setSp(n);
            }}
            style={{ width: 150 }}
          >
            <option value="">همه</option>
            <option value="conflict">دارای مغایرت</option>
            <option value="offline">ثبت آفلاین</option>
          </select>
        </Field>
        {range ? (
          <DateRangeFilter value={range} onChange={setRange} />
        ) : (
          <button className="btn" onClick={() => setRange({ preset: '7d', from: new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })}>
            <Icon name="clock" />
            فیلتر تاریخ
          </button>
        )}
      </div>
      <Card bodyClass="table-wrap">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} retry={() => q.refetch()} />
        ) : !q.data?.items.length ? (
          <Empty>سفارشی یافت نشد</Empty>
        ) : (
          <div className={q.isFetching ? 'refetching' : ''}>
            <table className="table">
              <thead>
                <tr>
                  <th>شماره سفارش</th>
                  <th>تاریخ</th>
                  <th>نوع</th>
                  <th>موبایل</th>
                  <th>وضعیت</th>
                  <th>رسید</th>
                  <th className="n">اقلام</th>
                  <th className="n">مبلغ</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => nav(`/orders/${o.id}`)} data-testid="order-row">
                    <td>
                      <Code>{o.orderNumber}</Code>{' '}
                      {o.offline && <Badge icon="wifiOff">آفلاین</Badge>} {o.conflictFlag && <Badge tone="danger">مغایرت</Badge>}
                    </td>
                    <td>
                      <JDateTime v={o.createdAt} />
                    </td>
                    <td>{ORDER_KIND_LABEL[o.kind]}</td>
                    <td>
                      <span className="ltr num">{o.mobileMasked}</span>
                    </td>
                    <td>
                      <Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                    </td>
                    <td className="muted">{o.status === 'PAID' ? PRINT_STATUS_LABEL[o.printStatus] : '—'}</td>
                    <td className="n">{formatNumberFa(o.itemsCount)}</td>
                    <td className="n">{formatToman(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => set('page', String(p))} />
          </div>
        )}
      </Card>
    </>
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Browser print of a receipt (reception printer). No QR on reprints: raw tokens are never stored. */
export function printReceiptInBrowser(r: ReceiptData) {
  const w = window.open('', '_blank', 'width=420,height=720');
  if (!w) return;
  const rows = r.lines
    .map((l) => `<tr><td>${esc(l.title)}<div class="c">${esc(l.code)} × ${l.quantity}</div></td><td class="n">${formatNumberFa(l.lineTotal)}</td></tr>`)
    .join('');
  w.document.write(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>${esc(r.orderNumber)}</title>
<style>@page{size:80mm auto;margin:3mm}body{font-family:Vazirmatn,Tahoma,sans-serif;width:72mm;margin:0 auto;font-size:12px}
h1{font-size:15px;text-align:center;margin:0}.s{text-align:center;margin:2px 0 8px}.m{display:flex;justify-content:space-between;margin:2px 0}
hr{border:0;border-top:1px dashed #000}table{width:100%;border-collapse:collapse}td{padding:3px 0;vertical-align:top}.n{text-align:left;white-space:nowrap}
.c{font-size:10px;direction:ltr;text-align:right}.t{font-weight:700;font-size:14px}.l{direction:ltr;unicode-bidi:embed}.f{text-align:center;font-size:10px;margin-top:8px}</style></head><body>
<h1>${esc(r.centerName)}</h1><div class="s">${esc(r.header)} — چاپ مجدد</div>
<div class="m"><span>شماره سفارش</span><span class="l">${esc(r.orderNumber)}</span></div>
<div class="m"><span>تاریخ پرداخت</span><span>${formatJalaliDateTime(r.paidAt ?? r.createdAt, r.timezone)}</span></div>
<div class="m"><span>موبایل</span><span class="l">${esc(r.mobileMasked)}</span></div><hr><table>${rows}</table><hr>
<div class="m"><span>جمع</span><span>${formatToman(r.subtotal)}</span></div>
${r.discountTotal ? `<div class="m"><span>تخفیف</span><span>${formatToman(r.discountTotal)}</span></div>` : ''}
<div class="m t"><span>پرداخت‌شده</span><span>${formatToman(r.total)}</span></div>
${r.payment.terminalRef ? `<div class="m"><span>مرجع کارتخوان</span><span class="l">${esc(r.payment.terminalRef)}</span></div>` : ''}
${r.subscription ? `<hr><div class="m"><span>اشتراک</span><span>${esc(r.subscription.planTitle)}</span></div><div class="m"><span>اعتبار تا</span><span>${formatJalaliDate(r.subscription.expiresAt, r.timezone)}</span></div>` : ''}
<div class="f">${esc(r.footer)}</div><script>window.onload=()=>{window.print();}</script></body></html>`);
  w.document.close();
}

function KioskPrintDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.get<DeviceRow[]>('/admin/devices') });
  const [deviceId, setDeviceId] = useState('');
  const toast = useToast();
  const list = devices.data?.filter((d) => d.active) ?? [];
  return (
    <Modal
      title="چاپ مجدد روی کیوسک"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            انصراف
          </button>
          <button
            className="btn btn-primary"
            disabled={!(deviceId || list[0]?.id)}
            onClick={async () => {
              try {
                await api.post(`/admin/orders/${orderId}/print`, { deviceId: deviceId || list[0].id });
                toast.push('فرمان چاپ برای کیوسک ارسال شد');
                onClose();
              } catch (e) {
                toast.push(errorMessage(e), true);
              }
            }}
          >
            <Icon name="printer" />
            ارسال فرمان چاپ
          </button>
        </>
      }
    >
      <Field label="کیوسک" help="فرمان در اولین ارتباط کیوسک (حداکثر ۳۰ ثانیه) اجرا می‌شود.">
        <select className="select" value={deviceId || list[0]?.id || ''} onChange={(e) => setDeviceId(e.target.value)}>
          {list.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.id}) {d.online ? '' : '— بدون ارتباط'}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}

/** A10 — order detail: price snapshots, payment attempts, reference, offline code, reprint. */
export function OrderDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [kioskPrint, setKioskPrint] = useState(false);
  const [resolve, setResolve] = useState(false);
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api.get<OrderDetail>(`/admin/orders/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const o = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['order', id] });

  return (
    <>
      <PageHead
        title={
          <>
            سفارش <Code>{o.orderNumber}</Code>
          </>
        }
        subtitle={`${ORDER_KIND_LABEL[o.kind]} — ثبت در ${formatJalaliDateTime(o.createdAt)} — دستگاه ${o.deviceId}`}
        actions={
          o.status === 'PAID' && (
            <>
              <button
                className="btn"
                onClick={async () => {
                  try {
                    printReceiptInBrowser(await api.get<ReceiptData>(`/admin/orders/${o.id}/receipt`));
                  } catch (e) {
                    toast.push(errorMessage(e), true);
                  }
                }}
              >
                <Icon name="printer" />
                چاپ رسید در پذیرش
              </button>
              <button className="btn btn-primary" onClick={() => setKioskPrint(true)}>
                <Icon name="printer" />
                چاپ مجدد روی کیوسک
              </button>
            </>
          )
        }
      />
      {o.conflictFlag && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="danger">
            <b>مغایرت نیازمند بررسی:</b> {o.conflictNote}
            <AdminOnly>
              <button className="btn btn-sm" style={{ marginInlineStart: 10 }} onClick={() => setResolve(true)}>
                ثبت بررسی
              </button>
            </AdminOnly>
          </Alert>
        </div>
      )}
      {!o.conflictFlag && o.conflictNote && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="info">{o.conflictNote}</Alert>
        </div>
      )}
      <div className="grid grid-2-1">
        <div className="grid" style={{ alignContent: 'start' }}>
          <Card title="اقلام و قیمت‌های قفل‌شده" sub="مبالغ این سفارش با تغییر تعرفه‌ها تغییر نمی‌کند" bodyClass="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>کد</th>
                  <th>عنوان</th>
                  <th className="n">تعداد</th>
                  <th className="n">قیمت واحد</th>
                  <th className="n">تخفیف واحد</th>
                  <th className="n">جمع</th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((i) => (
                  <tr key={i.itemId}>
                    <td>
                      <Code>{i.code}</Code>
                    </td>
                    <td>
                      {i.title}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {i.categoryTitle ?? 'اشتراک'} {i.discountTitle ? `· ${i.discountTitle}` : ''}
                      </div>
                    </td>
                    <td className="n">{formatNumberFa(i.quantity)}</td>
                    <td className="n">{formatToman(i.unitPrice)}</td>
                    <td className="n">{i.unitDiscount ? formatToman(i.unitDiscount) : '—'}</td>
                    <td className="n">{formatToman(i.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="تلاش‌های پرداخت" bodyClass="table-wrap">
            {o.payments.length === 0 ? (
              <div className="empty">هنوز پرداختی آغاز نشده است</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>شروع</th>
                    <th>وضعیت</th>
                    <th>منبع</th>
                    <th>مرجع کارتخوان / RRN</th>
                    <th className="n">مبلغ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {o.payments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <JDateTime v={p.initiatedAt} />
                      </td>
                      <td>
                        <Badge tone={PAYMENT_TONE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</Badge>
                        {p.reconcileReason && <div className="muted" style={{ fontSize: 12 }}>تطبیق: {p.reconcileReason}</div>}
                      </td>
                      <td className="muted">{p.source ? PAYMENT_SOURCE_LABEL[p.source] : '—'}</td>
                      <td>
                        {p.terminalRef ? <Code>{p.terminalRef}</Code> : '—'} {p.rrn && <Code>{p.rrn}</Code>}
                      </td>
                      <td className="n">{formatToman(p.amount)}</td>
                      <td>
                        <PaymentActions p={p} onChanged={refresh} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Card title="خلاصه">
            <dl className="kv-list">
              <dt>وضعیت</dt>
              <dd>
                <Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
              </dd>
              <dt>موبایل</dt>
              <dd className="ltr">{o.mobileMasked}</dd>
              <dt>جمع</dt>
              <dd>{formatToman(o.subtotal)}</dd>
              <dt>تخفیف</dt>
              <dd>{formatToman(o.discountTotal)}</dd>
              <dt>مبلغ نهایی</dt>
              <dd style={{ fontSize: 18 }}>{formatToman(o.total)}</dd>
              <dt>قفل قیمت</dt>
              <dd>
                <JDateTime v={o.lockedAt} />
              </dd>
              <dt>پرداخت</dt>
              <dd>
                <JDateTime v={o.paidAt} />
              </dd>
              <dt>رسید</dt>
              <dd>{PRINT_STATUS_LABEL[o.printStatus]}</dd>
              <dt>ثبت</dt>
              <dd>{o.offline ? <Badge icon="wifiOff">آفلاین (همگام‌سازی‌شده)</Badge> : 'آنلاین'}</dd>
              <dt>شناسه محلی</dt>
              <dd>
                <Code>{o.localId.slice(0, 8)}</Code>
              </dd>
            </dl>
          </Card>
          {o.subscription && (
            <Card title="اشتراک صادرشده" actions={<Link to={`/subscriptions/${o.subscription.id}`}>جزئیات</Link>}>
              <dl className="kv-list">
                <dt>پلن</dt>
                <dd>{o.subscription.planTitle}</dd>
                <dt>شروع</dt>
                <dd>{formatJalaliDate(o.subscription.startsAt)}</dd>
                <dt>پایان</dt>
                <dd>{formatJalaliDate(o.subscription.expiresAt)}</dd>
              </dl>
            </Card>
          )}
        </div>
      </div>
      {kioskPrint && <KioskPrintDialog orderId={o.id} onClose={() => setKioskPrint(false)} />}
      {resolve && (
        <ReasonDialog
          title="ثبت بررسی مغایرت"
          confirmLabel="ثبت و بستن مغایرت"
          description="شرح اقدامی که برای رفع مغایرت انجام شد (مثلاً استرداد وجه یا تأیید قیمت آفلاین) را ثبت کنید. سفارش و مبالغ تغییر نمی‌کنند."
          onCancel={() => setResolve(false)}
          onConfirm={async (reason) => {
            await api.post(`/admin/orders/${o.id}/resolve-conflict`, { reason });
            setResolve(false);
            refresh();
          }}
        />
      )}
    </>
  );
}
