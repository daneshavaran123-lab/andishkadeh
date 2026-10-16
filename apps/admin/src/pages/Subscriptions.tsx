import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import {
  ACCESS_RESULT_LABEL,
  formatJalaliDate,
  type AdminPlan,
  type SubscriptionDetail,
  type SubscriptionRow,
  type SubscriptionState,
} from '@andishkadeh/shared';
import { api, qs } from '../api';
import { AdminOnly } from '../auth';
import { Icon } from '../components/Icon';
import { Alert, Badge, Card, Code, Empty, ErrorBox, Field, JDate, JDateTime, Loading, Modal, PageHead, Pagination, ReasonDialog, useToast, type Tone } from '../components/ui';
import { escapeHtml } from '../html';

const STATE: Record<SubscriptionState, { label: string; tone: Tone }> = {
  active: { label: 'فعال', tone: 'success' },
  upcoming: { label: 'در انتظار شروع', tone: 'info' },
  expired: { label: 'منقضی', tone: 'warning' },
  cancelled: { label: 'ابطال‌شده', tone: 'danger' },
};

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** A07 — subscriptions: search by mobile or order number, state and plan filters. */
export function Subscriptions() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const [term, setTerm] = useState(sp.get('q') ?? '');
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<AdminPlan[]>('/admin/plans') });
  const page = Number(sp.get('page') ?? 1);
  const query = qs({ page, pageSize: 25, q: sp.get('q'), state: sp.get('state'), planId: sp.get('planId') });
  const q = useQuery({ queryKey: ['subscriptions', query], queryFn: () => api.get<Page<SubscriptionRow>>(`/admin/subscriptions${query}`) });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n);
  };
  return (
    <>
      <PageHead title="اشتراک‌ها" subtitle="اعتبار، وضعیت QR و سوابق؛ اشتراک فقط پس از پرداخت تأییدشده فعال می‌شود" />
      <div className="toolbar">
        <Field label="جست‌وجو">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              set('q', term.trim());
            }}
          >
            <input className="input" placeholder="شماره موبایل یا شماره سفارش" value={term} onChange={(e) => setTerm(e.target.value)} style={{ width: 260 }} />
          </form>
        </Field>
        <Field label="وضعیت">
          <select className="select" value={sp.get('state') ?? ''} onChange={(e) => set('state', e.target.value)} style={{ width: 160 }}>
            <option value="">همه</option>
            {(Object.keys(STATE) as SubscriptionState[]).map((s) => (
              <option key={s} value={s}>
                {STATE[s].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="پلن">
          <select className="select" value={sp.get('planId') ?? ''} onChange={(e) => set('planId', e.target.value)} style={{ width: 170 }}>
            <option value="">همه</option>
            {plans.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Card bodyClass="table-wrap">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !q.data?.items.length ? (
          <Empty>اشتراکی یافت نشد</Empty>
        ) : (
          <div className={q.isFetching ? 'refetching' : ''}>
            <table className="table">
              <thead>
                <tr>
                  <th>عضو</th>
                  <th>پلن</th>
                  <th>شروع</th>
                  <th>پایان</th>
                  <th>وضعیت</th>
                  <th>سفارش</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => nav(`/subscriptions/${s.id}`)}>
                    <td>
                      <span className="ltr num">{s.mobileMasked}</span>
                    </td>
                    <td>{s.planTitle}</td>
                    <td>
                      <JDate v={s.startsAt} />
                    </td>
                    <td>
                      <JDate v={s.expiresAt} />
                    </td>
                    <td>
                      <Badge tone={STATE[s.state].tone}>{STATE[s.state].label}</Badge>
                    </td>
                    <td>
                      <Code>{s.orderNumber}</Code>
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

function QrOnce({ token, planTitle, expiresAt, onClose }: { token: string; planTitle: string; expiresAt: string; onClose: () => void }) {
  const [svg, setSvg] = useState('');
  useEffect(() => void QRCode.toString(token, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setSvg), [token]);
  const print = () => {
    const w = window.open('', '_blank', 'width=420,height=600');
    if (!w) return;
    w.document.write(
      `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><style>body{font-family:Vazirmatn,Tahoma;text-align:center;width:72mm;margin:0 auto}svg{width:52mm;height:52mm}</style></head><body><h3>کارت عضویت (صدور مجدد)</h3><div>${escapeHtml(planTitle)}</div><div>اعتبار تا ${formatJalaliDate(expiresAt)}</div>${svg}<p style="font-size:11px">کارت قبلی باطل شده است.</p><script>onload=()=>print()</script></body></html>`,
    );
    w.document.close();
  };
  return (
    <Modal
      title="QR جدید صادر شد"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            بستن (QR دیگر نمایش داده نمی‌شود)
          </button>
          <button className="btn btn-primary" onClick={print}>
            <Icon name="printer" />
            چاپ کارت عضویت
          </button>
        </>
      }
    >
      <Alert tone="warning">این کد فقط همین یک بار نمایش داده می‌شود و ذخیره نمی‌شود. کارت عضویت قبلی از هم‌اکنون نامعتبر است.</Alert>
      <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }} dangerouslySetInnerHTML={{ __html: svg.replace('<svg', '<svg width="240" height="240"') }} />
    </Modal>
  );
}

/** A07/A12 — member detail: validity, history, QR checks. Raw QR tokens are never shown here. */
export function SubscriptionDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [action, setAction] = useState<null | 'cancel' | 'extend' | 'reissue'>(null);
  const [days, setDays] = useState(7);
  const [qr, setQr] = useState<{ qrToken: string; planTitle: string; expiresAt: string } | null>(null);
  const q = useQuery({ queryKey: ['subscription', id], queryFn: () => api.get<SubscriptionDetail>(`/admin/subscriptions/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const s = q.data;
  const done = (msg: string) => {
    setAction(null);
    toast.push(msg);
    qc.invalidateQueries({ queryKey: ['subscription', id] });
  };
  return (
    <>
      <PageHead
        title={`اشتراک ${s.planTitle}`}
        subtitle={
          <>
            عضو <span className="ltr">{s.mobileMasked}</span> — سفارش <Link to={`/orders/${s.orderId}`}>{s.orderNumber}</Link>
          </>
        }
        actions={
          <AdminOnly>
            {s.status !== 'CANCELLED' && (
              <>
                <button className="btn" onClick={() => setAction('extend')}>
                  <Icon name="plus" />
                  تمدید دستی
                </button>
                <button className="btn" onClick={() => setAction('reissue')}>
                  <Icon name="qr" />
                  صدور مجدد QR
                </button>
                <button className="btn btn-danger" onClick={() => setAction('cancel')}>
                  <Icon name="x" />
                  ابطال
                </button>
              </>
            )}
          </AdminOnly>
        }
      />
      <div className="grid grid-2-1">
        <div className="grid" style={{ alignContent: 'start' }}>
          <Card title="سوابق بررسی QR در کیوسک" bodyClass="table-wrap">
            {s.accessLogs.length === 0 ? (
              <div className="empty">هنوز بررسی‌ای ثبت نشده است</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>زمان</th>
                    <th>نتیجه</th>
                    <th>دستگاه</th>
                    <th>حالت</th>
                  </tr>
                </thead>
                <tbody>
                  {s.accessLogs.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <JDateTime v={l.checkedAt} />
                      </td>
                      <td>
                        <Badge tone={l.result === 'ACTIVE' ? 'success' : l.result === 'EXPIRED' ? 'warning' : 'danger'}>{ACCESS_RESULT_LABEL[l.result]}</Badge>
                      </td>
                      <td>
                        <Code>{l.deviceId}</Code>
                      </td>
                      <td className="muted">{l.offline ? 'آفلاین (کش کیوسک)' : 'آنلاین'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="سوابق اشتراک‌های این عضو" bodyClass="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>پلن</th>
                  <th>شروع</th>
                  <th>پایان</th>
                  <th>وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {s.memberHistory.map((h) => (
                  <tr key={h.id} style={h.id === s.id ? { background: 'var(--primary-soft)' } : undefined}>
                    <td>
                      <Link to={`/subscriptions/${h.id}`}>{h.planTitle}</Link>
                    </td>
                    <td>
                      <JDate v={h.startsAt} />
                    </td>
                    <td>
                      <JDate v={h.expiresAt} />
                    </td>
                    <td>
                      <Badge tone={STATE[h.state].tone}>{STATE[h.state].label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <Card title="اعتبار">
          <dl className="kv-list">
            <dt>وضعیت</dt>
            <dd>
              <Badge tone={STATE[s.state].tone}>{STATE[s.state].label}</Badge>
            </dd>
            <dt>شروع</dt>
            <dd>
              <JDate v={s.startsAt} />
            </dd>
            <dt>پایان</dt>
            <dd>
              <JDate v={s.expiresAt} />
            </dd>
            <dt>صدور QR</dt>
            <dd>
              <JDateTime v={s.qrIssuedAt} />
            </dd>
            {s.cancelReason && (
              <>
                <dt>دلیل ابطال</dt>
                <dd>{s.cancelReason}</dd>
              </>
            )}
          </dl>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.8, marginBottom: 0 }}>
            توکن QR به‌صورت هش ذخیره می‌شود و در پنل قابل مشاهده نیست. برای کارت گمشده، پس از احراز هویت عضو از «صدور مجدد QR» استفاده کنید.
          </p>
        </Card>
      </div>
      {action === 'cancel' && (
        <ReasonDialog
          title="ابطال اشتراک"
          danger
          confirmLabel="ابطال اشتراک"
          description="کارت عضویت بلافاصله در کیوسک‌ها نامعتبر می‌شود. استرداد وجه خارج از این سامانه انجام می‌شود."
          onCancel={() => setAction(null)}
          onConfirm={async (reason) => {
            await api.post(`/admin/subscriptions/${s.id}/cancel`, { reason });
            done('اشتراک ابطال شد');
          }}
        />
      )}
      {action === 'extend' && (
        <ReasonDialog
          title="تمدید دستی اشتراک"
          confirmLabel="ثبت تمدید"
          extra={
            <Field label="تعداد روز">
              <input className="input num" type="number" min={1} max={400} value={days} onChange={(e) => setDays(Number(e.target.value))} />
            </Field>
          }
          onCancel={() => setAction(null)}
          onConfirm={async (reason) => {
            await api.post(`/admin/subscriptions/${s.id}/extend`, { days, reason });
            done('تمدید ثبت شد');
          }}
        />
      )}
      {action === 'reissue' && (
        <ReasonDialog
          title="صدور مجدد QR"
          confirmLabel="صدور QR جدید"
          description="QR قبلی بلافاصله باطل می‌شود. پیش از صدور، هویت عضو را مطابق رویه مرکز احراز کنید."
          onCancel={() => setAction(null)}
          onConfirm={async (reason) => {
            const r = await api.post<{ qrToken: string; planTitle: string; expiresAt: string }>(`/admin/subscriptions/${s.id}/reissue-qr`, { reason });
            setAction(null);
            setQr(r);
            qc.invalidateQueries({ queryKey: ['subscription', id] });
          }}
        />
      )}
      {qr && <QrOnce token={qr.qrToken} planTitle={qr.planTitle} expiresAt={qr.expiresAt} onClose={() => setQr(null)} />}
    </>
  );
}
