import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AuditRow } from '@andishkadeh/shared';
import { api, qs } from '../api';
import { Card, Code, Empty, ErrorBox, Field, JDateTime, Loading, PageHead, Pagination } from '../components/ui';

const ACTIONS: Record<string, string> = {
  'service.price_changed': 'تغییر تعرفه خدمت',
  'service.updated': 'ویرایش خدمت',
  'service.created': 'ایجاد خدمت',
  'service.deleted': 'حذف خدمت',
  'plan.price_changed': 'تغییر قیمت پلن',
  'plan.updated': 'ویرایش پلن',
  'plan.created': 'ایجاد پلن',
  'discount.created': 'ایجاد تخفیف',
  'discount.updated': 'ویرایش تخفیف',
  'discount.deleted': 'حذف تخفیف',
  'category.created': 'ایجاد حوزه',
  'category.updated': 'ویرایش حوزه',
  'category.reordered': 'تغییر ترتیب حوزه‌ها',
  'subcategory.created': 'ایجاد زیرگروه',
  'subcategory.updated': 'ویرایش زیرگروه',
  'subcategory.reordered': 'تغییر ترتیب زیرگروه‌ها',
  'settings.updated': 'تغییر تنظیمات',
  'content.updated': 'تغییر محتوای کیوسک',
  'media.uploaded': 'بارگذاری تصویر',
  'media.deleted': 'حذف تصویر',
  'payment.reconciled': 'تطبیق دستی پرداخت',
  'payment.conflict': 'مغایرت پرداخت',
  'payment.inquiry_requested': 'درخواست استعلام پرداخت',
  'order.reprint_requested': 'درخواست چاپ مجدد',
  'order.conflict_resolved': 'بررسی مغایرت سفارش',
  'subscription.cancelled': 'ابطال اشتراک',
  'subscription.extended': 'تمدید دستی اشتراک',
  'subscription.qr_reissued': 'صدور مجدد QR',
  'device.created': 'ثبت دستگاه',
  'device.updated': 'ویرایش دستگاه',
  'device.key_rotated': 'تعویض کلید دستگاه',
  'sync.retry_requested': 'درخواست همگام‌سازی',
  'sync.event_retried': 'اعمال مجدد رویداد',
  'user.created': 'ایجاد کاربر',
  'user.updated': 'ویرایش کاربر',
  'user.password_reset': 'بازنشانی رمز کاربر',
  'auth.login': 'ورود',
  'auth.locked': 'قفل حساب پس از تلاش ناموفق',
  'auth.password_changed': 'تغییر رمز',
};

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** A18 — append-only audit trail (actor, time, before/after, reason). */
export function Audit() {
  const [sp, setSp] = useSearchParams();
  const [open, setOpen] = useState<string | null>(null);
  const page = Number(sp.get('page') ?? 1);
  const query = qs({ page, pageSize: 30, action: sp.get('action'), entityType: sp.get('entityType') });
  const q = useQuery({ queryKey: ['audit', query], queryFn: () => api.get<Page<AuditRow>>(`/admin/audit${query}`) });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n);
  };
  return (
    <>
      <PageHead title="سوابق تغییرات" subtitle="ثبت غیرقابل ویرایش تغییرات قیمت، تخفیف، اشتراک، پرداخت و تنظیمات" />
      <div className="toolbar">
        <Field label="گروه رویداد">
          <select className="select" value={sp.get('action') ?? ''} onChange={(e) => set('action', e.target.value)} style={{ width: 220 }}>
            <option value="">همه</option>
            <option value="service.">خدمات و تعرفه</option>
            <option value="plan.">پلن‌ها</option>
            <option value="discount.">تخفیف‌ها</option>
            <option value="payment.">پرداخت‌ها</option>
            <option value="subscription.">اشتراک‌ها</option>
            <option value="settings.">تنظیمات</option>
            <option value="user.">کاربران</option>
            <option value="auth.">ورود و امنیت</option>
          </select>
        </Field>
      </div>
      <Card bodyClass="table-wrap">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !q.data?.items.length ? (
          <Empty>رویدادی ثبت نشده است</Empty>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>زمان</th>
                  <th>کاربر</th>
                  <th>رویداد</th>
                  <th>موجودیت</th>
                  <th>دلیل</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td>
                        <JDateTime v={r.createdAt} />
                      </td>
                      <td>{r.actorName}</td>
                      <td>{ACTIONS[r.action] ?? r.action}</td>
                      <td>
                        {r.entityType} {r.entityId && <Code>{r.entityId.slice(0, 8)}</Code>}
                      </td>
                      <td className="muted" style={{ maxWidth: 260 }}>
                        {r.reason ?? '—'}
                      </td>
                      <td>
                        {(r.before !== null || r.after !== null) && (
                          <button className="btn btn-sm" onClick={() => setOpen(open === r.id ? null : r.id)}>
                            {open === r.id ? 'بستن' : 'قبل / بعد'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr>
                        <td colSpan={6}>
                          <div className="diff">
                            <div>
                              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                                قبل
                              </div>
                              <pre>{JSON.stringify(r.before, null, 2)}</pre>
                            </div>
                            <div>
                              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                                بعد
                              </div>
                              <pre>{JSON.stringify(r.after, null, 2)}</pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => set('page', String(p))} />
          </>
        )}
      </Card>
    </>
  );
}
