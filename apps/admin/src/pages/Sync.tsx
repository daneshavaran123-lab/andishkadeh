import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SYNC_STATUS_LABEL, toPersianDigits, type SyncOverview } from '@andishkadeh/shared';
import { api, errorMessage, qs } from '../api';
import { AdminOnly } from '../auth';
import { Icon } from '../components/Icon';
import { Alert, Badge, Card, Code, Empty, ErrorBox, Field, JDateTime, Loading, PageHead, relativeAge, useAction, useToast } from '../components/ui';

const TYPE_LABEL: Record<string, string> = {
  ORDER_OFFLINE: 'سفارش آفلاین',
  PAYMENT_RESULT: 'نتیجه پرداخت',
  ACCESS_LOG: 'بررسی QR',
  RECEIPT_PRINT: 'وضعیت چاپ',
  COMMAND_RESULT: 'نتیجه فرمان',
};

/** A12 — device outbox state and server-side event log; retries are idempotent (no double charge). */
export function Sync() {
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? '';
  const qc = useQueryClient();
  const toast = useToast();
  const action = useAction();
  const query = qs({ status });
  const q = useQuery({ queryKey: ['sync', query], queryFn: () => api.get<SyncOverview>(`/admin/sync${query}`), refetchInterval: 15_000 });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const d = q.data;
  return (
    <>
      <PageHead title="همگام‌سازی" subtitle="رویدادهای کیوسک با شناسه یکتا ارسال می‌شوند؛ ارسال دوباره هرگز سفارش یا پرداخت تکراری نمی‌سازد" />
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <div className="card stat">
          <span className="label">اعمال‌شده</span>
          <div className="value">{toPersianDigits(d.totals.applied)}</div>
        </div>
        <div className="card stat">
          <span className="label">دارای مغایرت (برای بررسی مدیر)</span>
          <div className="value">{toPersianDigits(d.totals.conflict)}</div>
        </div>
        <div className="card stat">
          <span className="label">ردشده</span>
          <div className="value">{toPersianDigits(d.totals.rejected)}</div>
        </div>
      </div>
      <Card title="صف کیوسک‌ها" bodyClass="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>دستگاه</th>
              <th>آخرین ارتباط</th>
              <th>آخرین همگام‌سازی</th>
              <th className="n">در انتظار</th>
              <th className="n">ناموفق</th>
              <th>قدیمی‌ترین رویداد معلق</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {d.devices.map((dev) => (
              <tr key={dev.id}>
                <td>
                  {dev.name} <Code>{dev.id}</Code>
                </td>
                <td>{relativeAge(dev.lastSeenAt)}</td>
                <td>{relativeAge(dev.lastSyncAt)}</td>
                <td className="n">{toPersianDigits(dev.outbox?.pending ?? 0)}</td>
                <td className="n">{dev.outbox?.failed ? <Badge tone="danger">{toPersianDigits(dev.outbox.failed)}</Badge> : '۰'}</td>
                <td>{dev.outbox?.oldestPendingAt ? relativeAge(dev.outbox.oldestPendingAt) : '—'}</td>
                <td>
                  <AdminOnly>
                    <button
                      className="btn btn-sm"
                      onClick={action(async () => {
                        try {
                          await api.post(`/admin/devices/${dev.id}/sync-now`);
                          toast.push('فرمان «همگام‌سازی فوری و تلاش مجدد ناموفق‌ها» ارسال شد');
                        } catch (e) {
                          toast.push(errorMessage(e), true);
                        }
                      })}
                    >
                      <Icon name="sync" />
                      تلاش مجدد
                    </button>
                  </AdminOnly>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div style={{ height: 18 }} />
      <Card
        title="رویدادهای دریافت‌شده"
        actions={
          <Field label="">
            <select
              className="select"
              value={status}
              onChange={(e) => {
                const n = new URLSearchParams(sp);
                if (e.target.value) n.set('status', e.target.value);
                else n.delete('status');
                setSp(n);
              }}
            >
              <option value="">همه وضعیت‌ها</option>
              <option value="APPLIED">اعمال‌شده</option>
              <option value="CONFLICT">مغایرت</option>
              <option value="REJECTED">ردشده</option>
            </select>
          </Field>
        }
        bodyClass="table-wrap"
      >
        {d.totals.conflict > 0 && (
          <div style={{ padding: '12px 16px 0' }}>
            <Alert tone="warning">رویدادهای دارای مغایرت اعمال شده‌اند و تراکنش مالی حفظ شده است؛ جزئیات در صفحه سفارش مربوط برای بررسی مدیر علامت‌گذاری شده است.</Alert>
          </div>
        )}
        {!d.events.length ? (
          <Empty icon="sync">رویدادی یافت نشد</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>نوع</th>
                <th>دستگاه</th>
                <th>دریافت</th>
                <th>وضعیت</th>
                <th>خطا</th>
                <th className="n">تلاش</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.events.map((e) => (
                <tr key={e.id}>
                  <td>{TYPE_LABEL[e.type] ?? e.type}</td>
                  <td>
                    <Code>{e.deviceId}</Code>
                  </td>
                  <td>
                    <JDateTime v={e.receivedAt} />
                  </td>
                  <td>
                    <Badge tone={e.status === 'APPLIED' ? 'success' : e.status === 'CONFLICT' ? 'warning' : 'danger'}>{SYNC_STATUS_LABEL[e.status]}</Badge>
                  </td>
                  <td className="muted" style={{ maxWidth: 320, fontSize: 12.5 }}>
                    {e.error ?? '—'}
                  </td>
                  <td className="n">{toPersianDigits(e.retryCount)}</td>
                  <td>
                    {e.status === 'REJECTED' && (
                      <AdminOnly>
                        <button
                          className="btn btn-sm"
                          onClick={action(async () => {
                            try {
                              await api.post(`/admin/sync/events/${e.id}/retry`);
                              toast.push('رویداد دوباره اعمال شد');
                              void qc.invalidateQueries({ queryKey: ['sync'] });
                            } catch (err) {
                              toast.push(errorMessage(err), true);
                            }
                          })}
                        >
                          اعمال مجدد
                        </button>
                      </AdminOnly>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
