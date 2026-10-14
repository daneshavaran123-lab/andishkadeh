import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PAYMENT_SOURCE_LABEL,
  PAYMENT_STATUS_LABEL,
  PaymentStatus,
  formatToman,
  type PaymentRow,
} from '@andishkadeh/shared';
import { api, errorMessage, qs } from '../api';
import { AdminOnly } from '../auth';
import { Icon } from '../components/Icon';
import { Alert, Badge, Card, Code, DateRangeFilter, Empty, ErrorBox, Field, JDateTime, Loading, PageHead, Pagination, ReasonDialog, Segmented, useToast, type RangePreset } from '../components/ui';
import { PAYMENT_TONE } from './Dashboard';

/** Documented manual resolution of an UNKNOWN payment (ADMIN, reason required, audited). */
export function ReconcileDialog({ payment, onClose, onDone }: { payment: PaymentRow; onClose: () => void; onDone: () => void }) {
  const [outcome, setOutcome] = useState<'PAID' | 'FAILED'>('PAID');
  const [terminalRef, setTerminalRef] = useState(payment.terminalRef ?? '');
  const [rrn, setRrn] = useState(payment.rrn ?? '');
  const toast = useToast();
  return (
    <ReasonDialog
      title={`تطبیق دستی پرداخت ${payment.orderNumber}`}
      confirmLabel="ثبت نتیجه تطبیق"
      onCancel={onClose}
      description={
        <>
          فقط بر اساس مستند معتبر (گزارش بانک/پذیرنده یا پاسخ استعلام) ثبت کنید. مبلغ تراکنش: <b>{formatToman(payment.amount)}</b>
        </>
      }
      extra={
        <>
          <Field label="نتیجه بر اساس مستند">
            <Segmented
              value={outcome}
              onChange={setOutcome}
              options={[
                { value: 'PAID', label: 'وجه دریافت شده (موفق)' },
                { value: 'FAILED', label: 'وجه دریافت نشده (ناموفق)' },
              ]}
            />
          </Field>
          <div className="form-grid">
            <Field label="مرجع تراکنش کارتخوان" help="اختیاری">
              <input className="input ltr" value={terminalRef} onChange={(e) => setTerminalRef(e.target.value)} />
            </Field>
            <Field label="شماره پیگیری بانک (RRN)" help="اختیاری">
              <input className="input ltr" value={rrn} onChange={(e) => setRrn(e.target.value)} />
            </Field>
          </div>
          {outcome === 'PAID' && <Alert tone="info">پس از ثبت موفق، سفارش پرداخت‌شده می‌شود و در صورت اشتراکی بودن، اشتراک فعال خواهد شد.</Alert>}
        </>
      }
      onConfirm={async (reason) => {
        await api.post(`/admin/payments/${payment.id}/reconcile`, { outcome, reason, terminalRef: terminalRef || undefined, rrn: rrn || undefined });
        toast.push('نتیجه تطبیق ثبت شد');
        onDone();
      }}
    />
  );
}

export function PaymentActions({ p, onChanged }: { p: PaymentRow; onChanged: () => void }) {
  const [reconcile, setReconcile] = useState(false);
  const toast = useToast();
  if (p.status !== 'UNKNOWN' && p.status !== 'INITIATED') return null;
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        className="btn btn-sm"
        onClick={async () => {
          try {
            await api.post(`/admin/payments/${p.id}/inquire`);
            toast.push('فرمان استعلام برای کیوسک ارسال شد؛ نتیجه پس از دریافت ثبت می‌شود');
            onChanged();
          } catch (e) {
            toast.push(errorMessage(e), true);
          }
        }}
      >
        <Icon name="sync" />
        استعلام
      </button>
      <AdminOnly>
        <button className="btn btn-sm btn-primary" onClick={() => setReconcile(true)} data-testid="reconcile">
          تطبیق دستی
        </button>
      </AdminOnly>
      {reconcile && (
        <ReconcileDialog
          payment={p}
          onClose={() => setReconcile(false)}
          onDone={() => {
            setReconcile(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** A11 — payment attempts: PAID / FAILED / UNKNOWN, inquiry and reconcile. */
export function Payments() {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const [range, setRange] = useState<{ preset: RangePreset; from: string; to: string } | null>(null);
  const status = sp.get('status') ?? '';
  const page = Number(sp.get('page') ?? 1);
  const [term, setTerm] = useState(sp.get('q') ?? '');
  const query = qs({ status, page, pageSize: 25, q: sp.get('q'), from: range?.from, to: range?.to });
  const q = useQuery({ queryKey: ['payments', query], queryFn: () => api.get<Page<PaymentRow>>(`/admin/payments${query}`) });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n);
  };

  return (
    <>
      <PageHead title="پرداخت‌ها" subtitle="پرداخت نامشخص فقط از مسیر استعلام یا تطبیق مستند تعیین تکلیف می‌شود" />
      <div className="toolbar">
        <Field label="جست‌وجو">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              set('q', term.trim());
            }}
          >
            <input className="input" placeholder="شماره سفارش، مرجع کارتخوان یا RRN" value={term} onChange={(e) => setTerm(e.target.value)} style={{ width: 280 }} />
          </form>
        </Field>
        <Field label="وضعیت">
          <select className="select" value={status} onChange={(e) => set('status', e.target.value)} style={{ width: 160 }}>
            <option value="">همه</option>
            {Object.values(PaymentStatus).map((s) => (
              <option key={s} value={s}>
                {PAYMENT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        {range ? (
          <DateRangeFilter value={range} onChange={setRange} />
        ) : (
          <button className="btn" onClick={() => setRange({ preset: '30d', ...{ from: '', to: '' }, ...presetLast30() })}>
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
          <Empty>تراکنشی با این مشخصات یافت نشد</Empty>
        ) : (
          <div className={q.isFetching ? 'refetching' : ''}>
            <table className="table">
              <thead>
                <tr>
                  <th>سفارش</th>
                  <th>شروع</th>
                  <th>تعیین تکلیف</th>
                  <th>وضعیت</th>
                  <th>منبع نتیجه</th>
                  <th>مرجع کارتخوان</th>
                  <th className="n">مبلغ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((p) => (
                  <tr key={p.id} data-testid={`payment-${p.status}`}>
                    <td>
                      <Link to={`/orders/${p.orderId}`}>
                        <Code>{p.orderNumber}</Code>
                      </Link>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {p.deviceId}
                      </div>
                    </td>
                    <td>
                      <JDateTime v={p.initiatedAt} />
                    </td>
                    <td>
                      <JDateTime v={p.resolvedAt} />
                      {p.reconciledBy && <div className="muted" style={{ fontSize: 12 }}>توسط {p.reconciledBy}</div>}
                    </td>
                    <td>
                      <Badge tone={PAYMENT_TONE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</Badge>
                    </td>
                    <td className="muted">{p.source ? PAYMENT_SOURCE_LABEL[p.source] : '—'}</td>
                    <td>{p.terminalRef ? <Code>{p.terminalRef}</Code> : <span className="muted">—</span>}</td>
                    <td className="n">{formatToman(p.amount)}</td>
                    <td>
                      <PaymentActions p={p} onChanged={() => qc.invalidateQueries({ queryKey: ['payments'] })} />
                    </td>
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

function presetLast30() {
  const to = new Date();
  const from = new Date(Date.now() - 29 * 86400000);
  const key = (d: Date) => d.toISOString().slice(0, 10);
  return { from: key(from), to: key(to) };
}
