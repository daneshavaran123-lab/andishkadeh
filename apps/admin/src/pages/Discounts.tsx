import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DISCOUNT_TARGET_LABEL,
  DISCOUNT_TYPE_LABEL,
  DiscountTargetType,
  DiscountType,
  formatJalaliDateTime,
  formatToman,
  toPersianDigits,
  type AdminCategory,
  type AdminDiscount,
  type AdminPlan,
  type AdminService,
  type DiscountPreviewRow,
  type DiscountUpsert,
} from '@andishkadeh/shared';
import { api, errorMessage } from '../api';
import { AdminOnly, useAuth } from '../auth';
import { ReadOnlyNote } from '../components/Layout';
import { Icon } from '../components/Icon';
import { Alert, Badge, Card, Code, Empty, ErrorBox, Field, JalaliDateTimeInput, Loading, Modal, PageHead, Segmented, Switch, useToast } from '../components/ui';
import { MoneyInput, useCategories } from './Catalog';

function TargetPicker({ targets, onChange, cats, services, plans }: { targets: DiscountUpsert['targets']; onChange: (t: DiscountUpsert['targets']) => void; cats: AdminCategory[]; services: AdminService[]; plans: AdminPlan[] }) {
  const [type, setType] = useState<DiscountTargetType>(DiscountTargetType.SERVICE);
  const [id, setId] = useState('');
  const options = useMemo(() => {
    switch (type) {
      case DiscountTargetType.CATEGORY:
        return cats.map((c) => ({ id: c.id, label: c.title }));
      case DiscountTargetType.SUBCATEGORY:
        return cats.flatMap((c) => c.subcategories.map((s) => ({ id: s.id, label: `${c.title} / ${s.title}` })));
      case DiscountTargetType.PLAN:
        return plans.map((p) => ({ id: p.id, label: p.title }));
      default:
        return services.filter((s) => s.price !== null).map((s) => ({ id: s.id, label: `${s.code} — ${s.title}` }));
    }
  }, [type, cats, services, plans]);
  const label = (t: DiscountUpsert['targets'][number]) => {
    if (t.targetType === 'CATEGORY') return cats.find((c) => c.id === t.targetId)?.title;
    if (t.targetType === 'SUBCATEGORY') return cats.flatMap((c) => c.subcategories).find((s) => s.id === t.targetId)?.title;
    if (t.targetType === 'PLAN') return plans.find((p) => p.id === t.targetId)?.title;
    const s = services.find((x) => x.id === t.targetId);
    return s ? `${s.code} — ${s.title}` : undefined;
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select className="select" style={{ width: 150 }} value={type} onChange={(e) => (setType(e.target.value as DiscountTargetType), setId(''))}>
          {Object.values(DiscountTargetType).map((t) => (
            <option key={t} value={t}>
              {DISCOUNT_TARGET_LABEL[t]}
            </option>
          ))}
        </select>
        <select className="select" style={{ flex: 1, minWidth: 220 }} value={id} onChange={(e) => setId(e.target.value)} data-testid="target-select">
          <option value="">انتخاب کنید…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={!id}
          onClick={() => {
            if (!targets.some((t) => t.targetType === type && t.targetId === id)) onChange([...targets, { targetType: type, targetId: id }]);
            setId('');
          }}
          data-testid="add-target"
        >
          <Icon name="plus" />
          افزودن هدف
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {targets.map((t) => (
          <span key={`${t.targetType}:${t.targetId}`} className="badge info">
            {DISCOUNT_TARGET_LABEL[t.targetType]}: {label(t) ?? '؟'}
            <button type="button" onClick={() => onChange(targets.filter((x) => x !== t))} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit' }} aria-label="حذف هدف">
              ×
            </button>
          </span>
        ))}
        {!targets.length && <span className="muted">هنوز هدفی انتخاب نشده است</span>}
      </div>
    </div>
  );
}

function DiscountDialog({ initial, onClose }: { initial: AdminDiscount | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cats = useCategories();
  const services = useQuery({ queryKey: ['services', ''], queryFn: () => api.get<AdminService[]>('/admin/services') });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<AdminPlan[]>('/admin/plans') });
  const [f, setF] = useState<DiscountUpsert>(
    initial
      ? { title: initial.title, type: initial.type as DiscountType, value: initial.value, priority: initial.priority, active: initial.active, startsAt: initial.startsAt, endsAt: initial.endsAt, targets: initial.targets.map((t) => ({ targetType: t.targetType as DiscountTargetType, targetId: t.targetId })) }
      : { title: '', type: DiscountType.PERCENT, value: 10, priority: 100, active: true, startsAt: null, endsAt: null, targets: [] },
  );
  const [preview, setPreview] = useState<DiscountPreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const runPreview = async () => {
    try {
      setPreview(await api.post<DiscountPreviewRow[]>('/admin/discounts/preview', { ...f, id: initial?.id }));
    } catch (e) {
      toast.push(errorMessage(e), true);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      if (initial) await api.patch(`/admin/discounts/${initial.id}`, f);
      else await api.post('/admin/discounts', f);
      toast.push('تخفیف ذخیره و منتشر شد');
      qc.invalidateQueries({ queryKey: ['discounts'] });
      onClose();
    } catch (e) {
      toast.push(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={initial ? `ویرایش ${initial.title}` : 'تخفیف جدید'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            انصراف
          </button>
          <button className="btn" onClick={runPreview} disabled={!f.targets.length} data-testid="preview-discount">
            <Icon name="eye" />
            پیش‌نمایش مبلغ نهایی
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !f.targets.length || !f.title} data-testid="save-discount">
            ذخیره و انتشار
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="عنوان" help="روی کیوسک و رسید نمایش داده می‌شود">
          <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="discount-title" />
        </Field>
        <Field label="نوع و مقدار">
          <div style={{ display: 'flex', gap: 8 }}>
            <Segmented
              value={f.type}
              onChange={(type) => setF({ ...f, type })}
              options={[
                { value: DiscountType.PERCENT, label: 'درصدی' },
                { value: DiscountType.FIXED, label: 'مبلغ ثابت' },
              ]}
            />
            {f.type === DiscountType.PERCENT ? (
              <input className="input num" type="number" min={1} max={100} value={f.value} onChange={(e) => setF({ ...f, value: Number(e.target.value) })} style={{ width: 100 }} data-testid="discount-value" />
            ) : (
              <MoneyInput value={f.value} onChange={(v) => setF({ ...f, value: v ?? 0 })} />
            )}
          </div>
        </Field>
        <Field label="هدف تخفیف" className="full">
          <TargetPicker targets={f.targets} onChange={(targets) => setF({ ...f, targets })} cats={cats.data ?? []} services={services.data ?? []} plans={plans.data ?? []} />
        </Field>
        <Field label="شروع اعتبار" help="خالی = از همین حالا">
          <JalaliDateTimeInput value={f.startsAt} onChange={(startsAt) => setF({ ...f, startsAt })} />
        </Field>
        <Field label="پایان اعتبار" help="خالی = بدون پایان">
          <JalaliDateTimeInput value={f.endsAt} onChange={(endsAt) => setF({ ...f, endsAt })} />
        </Field>
        <Field label="اولویت" help="فقط در سیاست «اولویت»: عدد کمتر = اولویت بالاتر">
          <input className="input num" type="number" min={0} value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })} />
        </Field>
        <div style={{ alignSelf: 'end' }}>
          <Switch checked={f.active} onChange={(active) => setF({ ...f, active })} label="فعال" />
        </div>
      </div>
      {preview && (
        <div style={{ marginTop: 18 }}>
          <Alert tone="info">پیش‌نمایش با در نظر گرفتن سایر تخفیف‌های فعال و سیاست هم‌پوشانی تنظیمات محاسبه شده است.</Alert>
          <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto', marginTop: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>کد</th>
                  <th>عنوان</th>
                  <th className="n">قیمت فعلی</th>
                  <th className="n">مبلغ نهایی</th>
                  <th>تخفیف اعمال‌شده</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.itemId} data-testid="preview-row">
                    <td>
                      <Code>{r.code}</Code>
                    </td>
                    <td>{r.title}</td>
                    <td className="n">{formatToman(r.price)}</td>
                    <td className="n">
                      <b>{formatToman(r.finalPrice)}</b>
                    </td>
                    <td>{r.appliedDiscount ?? <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!preview.length && <Empty>هیچ خدمت قیمت‌دار یا پلنی تحت این هدف نیست</Empty>}
        </div>
      )}
    </Modal>
  );
}

/** A06 — discounts: percent/fixed, per service / subgroup / domain / plan, window, preview. */
export function Discounts() {
  const q = useQuery({ queryKey: ['discounts'], queryFn: () => api.get<AdminDiscount[]>('/admin/discounts') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ discountPolicy: string }>('/admin/settings') });
  const qc = useQueryClient();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [edit, setEdit] = useState<AdminDiscount | null | 'new'>(null);
  return (
    <>
      <PageHead
        title="تخفیف‌ها"
        subtitle={`سیاست تخفیف‌های هم‌پوشان: ${settings.data?.discountPolicy === 'PRIORITY' ? 'اولویت' : 'بیشترین تخفیف'} (قابل تغییر در تنظیمات) — در هر قلم فقط یک تخفیف اعمال می‌شود`}
        actions={
          <AdminOnly>
            <button className="btn btn-primary" onClick={() => setEdit('new')} data-testid="new-discount">
              <Icon name="plus" />
              تخفیف جدید
            </button>
          </AdminOnly>
        }
      />
      <ReadOnlyNote />
      <Card bodyClass="table-wrap">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !q.data?.length ? (
          <Empty icon="tag">هنوز تخفیفی تعریف نشده است</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>عنوان</th>
                <th>مقدار</th>
                <th>اهداف</th>
                <th>بازه اعتبار</th>
                <th>وضعیت</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.map((d) => (
                <tr key={d.id}>
                  <td>
                    <b>{d.title}</b>
                    <div className="muted" style={{ fontSize: 12 }}>اولویت {toPersianDigits(d.priority)}</div>
                  </td>
                  <td>
                    {DISCOUNT_TYPE_LABEL[d.type as DiscountType]}: {d.type === 'PERCENT' ? `${toPersianDigits(d.value)}٪` : formatToman(d.value)}
                  </td>
                  <td style={{ maxWidth: 360 }}>
                    {d.targets.map((t) => (
                      <div key={t.targetType + t.targetId} style={{ fontSize: 12.5 }}>
                        {DISCOUNT_TARGET_LABEL[t.targetType as DiscountTargetType]}: {t.label}
                      </div>
                    ))}
                  </td>
                  <td style={{ fontSize: 12.5 }}>
                    {d.startsAt ? formatJalaliDateTime(d.startsAt) : 'از ابتدا'} — {d.endsAt ? formatJalaliDateTime(d.endsAt) : 'بدون پایان'}
                  </td>
                  <td>{d.live ? <Badge tone="success">در حال اعمال</Badge> : d.active ? <Badge tone="info">خارج از بازه</Badge> : <Badge>غیرفعال</Badge>}</td>
                  <td>
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm" onClick={() => setEdit(d)}>
                          ویرایش
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={async () => {
                            if (!window.confirm(`تخفیف «${d.title}» حذف شود؟ سفارش‌های قبلی تغییری نمی‌کنند.`)) return;
                            try {
                              await api.del(`/admin/discounts/${d.id}`);
                              toast.push('تخفیف حذف شد');
                              qc.invalidateQueries({ queryKey: ['discounts'] });
                            } catch (e) {
                              toast.push(errorMessage(e), true);
                            }
                          }}
                        >
                          حذف
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {edit && <DiscountDialog initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}
