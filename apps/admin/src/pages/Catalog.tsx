import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CategoryTheme,
  formatToman,
  normalizeDigits,
  toPersianDigits,
  type AdminCategory,
  type AdminService,
  type AdminSubcategory,
  type CategoryUpsert,
  type ServiceUpsert,
  type SubcategoryUpsert,
} from '@andishkadeh/shared';
import { ApiError, api, errorMessage, qs } from '../api';
import { AdminOnly, useAuth } from '../auth';
import { ReadOnlyNote } from '../components/Layout';
import { Icon } from '../components/Icon';
import { Alert, Badge, Card, Code, Empty, ErrorBox, Field, Loading, Modal, PageHead, Switch, useToast } from '../components/ui';
import { MediaPicker } from './Media';

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api.get<AdminCategory[]>('/admin/categories') });
}

/** Persian/Arabic digits and thousands separators → integer Toman (or null when empty). */
export function parseMoney(input: string): number | null {
  const s = normalizeDigits(input).replace(/[,٬\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 0 ? n : NaN;
}

export function MoneyInput({ value, onChange, disabled, placeholder }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean; placeholder?: string }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  const parsed = parseMoney(text);
  return (
    <div>
      <input
        className={`input ltr num${Number.isNaN(parsed) ? ' invalid' : ''}`}
        style={{ display: 'block', textAlign: 'left' }}
        inputMode="numeric"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const p = parseMoney(e.target.value);
          if (!Number.isNaN(p)) onChange(p);
        }}
      />
      {parsed !== null && !Number.isNaN(parsed) && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{formatToman(parsed)}</div>}
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: '', label: 'همه' },
  { value: 'active', label: 'فعال در کیوسک' },
  { value: 'inactive', label: 'غیرفعال' },
  { value: 'noprice', label: 'بدون تعرفه (نیازمند تکمیل)' },
];

/** A04 — services and tariffs. */
export function Services() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const cats = useCategories();
  const [term, setTerm] = useState(sp.get('q') ?? '');
  const query = qs({ q: sp.get('q'), categoryId: sp.get('categoryId'), status: sp.get('status') });
  const q = useQuery({ queryKey: ['services', query], queryFn: () => api.get<AdminService[]>(`/admin/services${query}`) });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n);
  };
  const noPrice = q.data?.filter((s) => s.price === null).length ?? 0;

  return (
    <>
      <PageHead
        title="خدمات و تعرفه‌ها"
        subtitle="تغییر قیمت پس از انتشار در کیوسک دیده می‌شود؛ سفارش‌های قبلی مبلغ قفل‌شده خود را حفظ می‌کنند"
        actions={
          <AdminOnly>
            <Link className="btn btn-primary" to="/catalog/services/new">
              <Icon name="plus" />
              افزودن خدمت
            </Link>
          </AdminOnly>
        }
      />
      <ReadOnlyNote />
      <div className="toolbar">
        <Field label="جست‌وجو">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              set('q', term.trim());
            }}
          >
            <input className="input" placeholder="کد یا عنوان خدمت" value={term} onChange={(e) => setTerm(e.target.value)} style={{ width: 240 }} data-testid="services-search" />
          </form>
        </Field>
        <Field label="حوزه">
          <select className="select" value={sp.get('categoryId') ?? ''} onChange={(e) => set('categoryId', e.target.value)} style={{ width: 200 }}>
            <option value="">همه حوزه‌ها</option>
            {cats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="وضعیت">
          <select className="select" value={sp.get('status') ?? ''} onChange={(e) => set('status', e.target.value)} style={{ width: 220 }}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {noPrice > 0 && !sp.get('status') && (
        <div style={{ marginBottom: 14 }}>
          <Alert tone="warning">
            {toPersianDigits(noPrice)} خدمت هنوز تعرفه تأییدشده ندارد و در کیوسک نمایش داده نمی‌شود.{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), set('status', 'noprice'))}>
              نمایش این خدمات
            </a>
          </Alert>
        </div>
      )}
      <Card bodyClass="table-wrap">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !q.data?.length ? (
          <Empty>خدمتی یافت نشد</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>کد</th>
                <th>عنوان</th>
                <th>حوزه / زیرگروه</th>
                <th>واحد</th>
                <th>وضعیت</th>
                <th className="n">تعرفه</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => nav(`/catalog/services/${s.id}`)} data-testid={`service-row-${s.code}`}>
                  <td style={{ width: 56 }}>{s.mediaUrl ? <img className="thumb" src={s.mediaUrl} alt="" /> : <div className="thumb" />}</td>
                  <td>
                    <Code>{s.code}</Code>
                  </td>
                  <td style={{ maxWidth: 380 }}>{s.title}</td>
                  <td className="muted">
                    {s.categoryTitle} / {s.subcategoryTitle}
                  </td>
                  <td>{s.unit}</td>
                  <td>{s.price === null ? <Badge tone="warning">بدون تعرفه</Badge> : s.active ? <Badge tone="success">فعال</Badge> : <Badge>غیرفعال</Badge>}</td>
                  <td className="n">{s.price === null ? '—' : formatToman(s.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

const emptyService = (subcategoryId = ''): ServiceUpsert => ({
  code: '',
  title: '',
  subcategoryId,
  description: '',
  includes: [],
  unit: 'نفر',
  price: null,
  mediaId: null,
  fullAccessIncluded: true,
  active: false,
  sortOrder: 0,
});

/** A04 form — unique code, title, group, unit, price, image, description, publish state. */
export function ServiceForm() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const cats = useCategories();
  const existing = useQuery({ queryKey: ['service', id], queryFn: () => api.get<AdminService>(`/admin/services/${id}`), enabled: !isNew });
  const [form, setForm] = useState<ServiceUpsert | null>(isNew ? emptyService() : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (existing.data) {
      const s = existing.data;
      setForm({ code: s.code, title: s.title, subcategoryId: s.subcategoryId, description: s.description, includes: s.includes, unit: s.unit, price: s.price, mediaId: s.mediaId, fullAccessIncluded: s.fullAccessIncluded, active: s.active, sortOrder: s.sortOrder });
    }
  }, [existing.data]);

  const groups = useMemo(() => cats.data ?? [], [cats.data]);
  if ((!isNew && existing.isLoading) || !form) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const ro = !isAdmin;
  const up = <K extends keyof ServiceUpsert>(k: K, v: ServiceUpsert[K]) => setForm({ ...form, [k]: v });

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const body = { ...form, code: form.code.trim().toUpperCase() };
      const saved = isNew ? await api.post<AdminService>('/admin/services', body) : await api.patch<AdminService>(`/admin/services/${id}`, body);
      toast.push(isNew ? 'خدمت ایجاد شد' : 'تغییرات ذخیره و برای کیوسک منتشر شد');
      await qc.invalidateQueries({ queryKey: ['services'] });
      qc.invalidateQueries({ queryKey: ['service', saved.id] });
      if (isNew) nav(`/catalog/services/${saved.id}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.details)) {
        setErrors(Object.fromEntries((e.details as Array<{ path: string; message: string }>).map((d) => [d.path, d.message])));
      }
      if (e instanceof ApiError && e.code === 'DUPLICATE_CODE') setErrors({ code: e.message });
      toast.push(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title={isNew ? 'افزودن خدمت' : existing.data?.title}
        subtitle={!isNew && existing.data ? `آخرین ویرایش ${toPersianDigits(existing.data.revision)} — تغییر قیمت در سوابق تغییرات ثبت می‌شود` : undefined}
        actions={
          <>
            <Link className="btn" to="/catalog/services">
              بازگشت
            </Link>
            {isAdmin && !isNew && (
              <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" />
                حذف
              </button>
            )}
            {isAdmin && (
              <button className="btn btn-primary" onClick={save} disabled={busy} data-testid="save-service">
                {busy ? <span className="spinner" /> : <Icon name="check" />}
                ذخیره و انتشار
              </button>
            )}
          </>
        }
      />
      <ReadOnlyNote />
      <div className="grid grid-2-1">
        <Card title="مشخصات خدمت">
          <div className="form-grid">
            <Field label="کد یکتا" help="مثال: P-102 (حروف لاتین، عدد و خط تیره)" error={errors.code}>
              <input className="input ltr" style={{ display: 'block' }} value={form.code} disabled={ro} onChange={(e) => up('code', e.target.value)} />
            </Field>
            <Field label="زیرگروه" error={errors.subcategoryId}>
              <select className="select" value={form.subcategoryId} disabled={ro} onChange={(e) => up('subcategoryId', e.target.value)}>
                <option value="">انتخاب کنید</option>
                {groups.map((c) => (
                  <optgroup key={c.id} label={c.title}>
                    {c.subcategories.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field label="عنوان" className="full" error={errors.title}>
              <input className="input" value={form.title} disabled={ro} onChange={(e) => up('title', e.target.value)} />
            </Field>
            <Field label="تعرفه (تومان)" help="خالی = تعرفه تأیید نشده؛ خدمت بدون تعرفه قابل فعال‌سازی نیست" error={errors.price}>
              <MoneyInput value={form.price} disabled={ro} onChange={(v) => up('price', v)} placeholder="مثلاً 1200000" />
            </Field>
            <Field label="واحد" help="نفر، جلسه، برنامه، دوره، تیم، ..." error={errors.unit}>
              <input className="input" value={form.unit} disabled={ro} onChange={(e) => up('unit', e.target.value)} />
            </Field>
            <Field label="توضیح" className="full" help="بدون ادعای درمان؛ برای نمایش در جزئیات خدمت در کیوسک">
              <textarea className="textarea" value={form.description} disabled={ro} onChange={(e) => up('description', e.target.value)} />
            </Field>
            <Field label="موارد شامل" className="full" help="هر مورد در یک خط">
              <textarea className="textarea" value={form.includes.join('\n')} disabled={ro} onChange={(e) => up('includes', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} />
            </Field>
            <Field label="ترتیب نمایش">
              <input className="input num" type="number" min={0} value={form.sortOrder} disabled={ro} onChange={(e) => up('sortOrder', Number(e.target.value))} />
            </Field>
          </div>
        </Card>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Card title="انتشار">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Switch checked={form.active} disabled={ro || form.price === null} onChange={(v) => up('active', v)} label="فعال و قابل فروش در کیوسک" />
              {form.price === null && <Alert tone="warning">برای فعال‌سازی، ابتدا تعرفه تأییدشده را وارد کنید.</Alert>}
              <Switch checked={form.fullAccessIncluded} disabled={ro} onChange={(v) => up('fullAccessIncluded', v)} label="تحت پوشش اشتراک کامل" />
            </div>
          </Card>
          <Card title="تصویر">
            <MediaPicker value={form.mediaId} onChange={(v) => up('mediaId', v)} disabled={ro} />
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>اگر تصویری انتخاب نشود، تصویر حوزه نمایش داده می‌شود.</p>
          </Card>
        </div>
      </div>
      {confirmDelete && (
        <Modal
          title="حذف خدمت"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmDelete(false)}>
                انصراف
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  try {
                    await api.del(`/admin/services/${id}`);
                    toast.push('خدمت حذف شد');
                    await qc.invalidateQueries({ queryKey: ['services'] });
                    nav('/catalog/services');
                  } catch (e) {
                    toast.push(errorMessage(e), true);
                  }
                }}
              >
                حذف
              </button>
            </>
          }
        >
          خدمت از کیوسک و فهرست خدمات حذف می‌شود. سفارش‌های قبلی با اطلاعات ثبت‌شده خود باقی می‌مانند و کد خدمت رزرو می‌ماند.
        </Modal>
      )}
    </>
  );
}

const THEMES: Array<{ value: CategoryTheme; label: string; color: string }> = [
  { value: CategoryTheme.BLUE, label: 'آبی', color: '#1689ff' },
  { value: CategoryTheme.RED, label: 'قرمز', color: '#ff284c' },
  { value: CategoryTheme.PURPLE, label: 'بنفش', color: '#a34bff' },
  { value: CategoryTheme.CYAN, label: 'فیروزه‌ای', color: '#00d6d1' },
];

function CategoryDialog({ initial, onClose }: { initial: AdminCategory | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<CategoryUpsert>(
    initial
      ? { code: initial.code, title: initial.title, subtitle: initial.subtitle, description: initial.description, theme: initial.theme as CategoryTheme, mediaId: initial.mediaId, sortOrder: initial.sortOrder, active: initial.active, salesEnabled: initial.salesEnabled, subscriptionCovered: initial.subscriptionCovered }
      : { code: '', title: '', subtitle: '', description: '', theme: CategoryTheme.BLUE, mediaId: null, sortOrder: 99, active: true, salesEnabled: true, subscriptionCovered: true },
  );
  const save = async () => {
    try {
      if (initial) await api.patch(`/admin/categories/${initial.id}`, f);
      else await api.post('/admin/categories', f);
      toast.push('حوزه ذخیره شد');
      qc.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    } catch (e) {
      toast.push(errorMessage(e), true);
    }
  };
  return (
    <Modal
      wide
      title={initial ? `ویرایش ${initial.title}` : 'افزودن حوزه'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            انصراف
          </button>
          <button className="btn btn-primary" onClick={save}>
            ذخیره و انتشار
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="کد">
          <input className="input ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        </Field>
        <Field label="عنوان">
          <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="زیرعنوان کارت" className="full">
          <input className="input" value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} />
        </Field>
        <Field label="توضیح" className="full">
          <textarea className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="رنگ حوزه">
          <div style={{ display: 'flex', gap: 8 }}>
            {THEMES.map((t) => (
              <button key={t.value} type="button" className={`btn btn-sm${f.theme === t.value ? ' btn-primary' : ''}`} onClick={() => setF({ ...f, theme: t.value })}>
                <span style={{ width: 12, height: 12, borderRadius: 6, background: t.color, display: 'inline-block' }} />
                {t.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="تصویر کارت">
          <MediaPicker value={f.mediaId} onChange={(mediaId) => setF({ ...f, mediaId })} />
        </Field>
        <div className="full" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Switch checked={f.active} onChange={(active) => setF({ ...f, active })} label="نمایش در کیوسک" />
          <Switch checked={f.salesEnabled} onChange={(salesEnabled) => setF({ ...f, salesEnabled })} label="فروش مستقل خدمات این حوزه" />
          <Switch checked={f.subscriptionCovered} onChange={(subscriptionCovered) => setF({ ...f, subscriptionCovered })} label="تحت پوشش اشتراک کامل" />
        </div>
        {!f.salesEnabled && <Alert tone="info">این حوزه در کیوسک فقط معرفی می‌شود (مانند مانیتورینگ در نسخه پایه) و خدمات آن قابل خرید جداگانه نیست.</Alert>}
      </div>
    </Modal>
  );
}

function SubcategoryDialog({ categoryId, initial, onClose }: { categoryId: string; initial: AdminSubcategory | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<SubcategoryUpsert>(
    initial ? { categoryId, code: initial.code, title: initial.title, description: initial.description, mediaId: initial.mediaId, sortOrder: initial.sortOrder, active: initial.active } : { categoryId, code: '', title: '', description: '', mediaId: null, sortOrder: 99, active: true },
  );
  const save = async () => {
    try {
      if (initial) await api.patch(`/admin/subcategories/${initial.id}`, f);
      else await api.post('/admin/subcategories', f);
      toast.push('زیرگروه ذخیره شد');
      qc.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    } catch (e) {
      toast.push(errorMessage(e), true);
    }
  };
  return (
    <Modal
      title={initial ? `ویرایش ${initial.title}` : 'افزودن زیرگروه'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            انصراف
          </button>
          <button className="btn btn-primary" onClick={save}>
            ذخیره
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="کد">
          <input className="input ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        </Field>
        <Field label="عنوان">
          <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="توضیح کوتاه" className="full">
          <input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="full">
          <Switch checked={f.active} onChange={(active) => setF({ ...f, active })} label="نمایش در کیوسک" />
        </div>
      </div>
    </Modal>
  );
}

/** A03 — domains & subgroups: CRUD, image, order, active state. */
export function Categories() {
  const q = useCategories();
  const qc = useQueryClient();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [editCat, setEditCat] = useState<AdminCategory | null | 'new'>(null);
  const [editSub, setEditSub] = useState<{ categoryId: string; sub: AdminSubcategory | null } | null>(null);

  const move = async (kind: 'categories' | 'subcategories', ids: string[], idx: number, dir: -1 | 1) => {
    const next = [...ids];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    try {
      await api.post(`/admin/${kind}/reorder`, { ids: next });
      qc.invalidateQueries({ queryKey: ['categories'] });
    } catch (e) {
      toast.push(errorMessage(e), true);
    }
  };

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const catIds = q.data.map((c) => c.id);

  return (
    <>
      <PageHead
        title="حوزه‌ها و زیرگروه‌ها"
        subtitle="ترتیب و وضعیت نمایش در کیوسک؛ تغییرات با revision جدید روی کیوسک اعمال می‌شود"
        actions={
          <AdminOnly>
            <button className="btn btn-primary" onClick={() => setEditCat('new')}>
              <Icon name="plus" />
              افزودن حوزه
            </button>
          </AdminOnly>
        }
      />
      <ReadOnlyNote />
      <div className="grid">
        {q.data.map((c, i) => (
          <Card
            key={c.id}
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 12, height: 12, borderRadius: 6, background: THEMES.find((t) => t.value === c.theme)?.color }} />
                {c.title} <Code>{c.code}</Code>
              </span>
            }
            sub={c.subtitle}
            actions={
              <>
                {!c.active && <Badge>مخفی</Badge>}
                {!c.salesEnabled && <Badge tone="info">فقط معرفی</Badge>}
                {isAdmin && (
                  <>
                    <button className="btn btn-sm icon-only" onClick={() => move('categories', catIds, i, -1)} disabled={i === 0} aria-label="بالا">
                      <Icon name="up" />
                    </button>
                    <button className="btn btn-sm icon-only" onClick={() => move('categories', catIds, i, 1)} disabled={i === catIds.length - 1} aria-label="پایین">
                      <Icon name="down" />
                    </button>
                    <button className="btn btn-sm" onClick={() => setEditCat(c)}>
                      <Icon name="edit" />
                      ویرایش
                    </button>
                    <button className="btn btn-sm" onClick={() => setEditSub({ categoryId: c.id, sub: null })}>
                      <Icon name="plus" />
                      زیرگروه
                    </button>
                  </>
                )}
              </>
            }
            bodyClass="table-wrap"
          >
            <table className="table">
              <tbody>
                {c.subcategories.map((s, si) => (
                  <tr key={s.id}>
                    <td style={{ width: 90 }}>
                      <Code>{s.code}</Code>
                    </td>
                    <td>
                      {s.title} {!s.active && <Badge>مخفی</Badge>}
                    </td>
                    <td className="muted">
                      <Link to={`/catalog/services?categoryId=${c.id}`}>{toPersianDigits(s.serviceCount)} خدمت</Link>
                    </td>
                    <td style={{ width: 180 }}>
                      {isAdmin && (
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button className="btn btn-sm icon-only" onClick={() => move('subcategories', c.subcategories.map((x) => x.id), si, -1)} disabled={si === 0} aria-label="بالا">
                            <Icon name="up" />
                          </button>
                          <button className="btn btn-sm icon-only" onClick={() => move('subcategories', c.subcategories.map((x) => x.id), si, 1)} disabled={si === c.subcategories.length - 1} aria-label="پایین">
                            <Icon name="down" />
                          </button>
                          <button className="btn btn-sm" onClick={() => setEditSub({ categoryId: c.id, sub: s })}>
                            ویرایش
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>
      {editCat && <CategoryDialog initial={editCat === 'new' ? null : editCat} onClose={() => setEditCat(null)} />}
      {editSub && <SubcategoryDialog categoryId={editSub.categoryId} initial={editSub.sub} onClose={() => setEditSub(null)} />}
    </>
  );
}
