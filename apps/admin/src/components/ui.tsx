import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import {
  DEFAULT_TIMEZONE,
  JALALI_MONTHS,
  addLocalDays,
  formatJalaliDate,
  formatJalaliDateTime,
  jalaliMonthLength,
  jalaliOf,
  jalaliToDateKey,
  localDateKey,
  toPersianDigits,
  zonedMidnight,
} from '@andishkadeh/shared';
import { Icon, type IconName } from './Icon';

// ------------------------------------------------------------------ layout bits

export function PageHead({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, sub, actions, children, bodyClass = 'card-body', className = '' }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; bodyClass?: string; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {actions && <div className="actions">{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_ICON: Record<Tone, IconName | null> = { success: 'check', warning: 'clock', danger: 'alert', info: 'info', neutral: null };

/** Status badge: colour is always paired with an icon and a label (never colour alone). */
export function Badge({ tone = 'neutral', children, icon }: { tone?: Tone; children: ReactNode; icon?: IconName | null }) {
  const ic = icon === undefined ? TONE_ICON[tone] : icon;
  return (
    <span className={`badge ${tone === 'neutral' ? '' : tone}`}>
      {ic && <Icon name={ic} />}
      {children}
    </span>
  );
}

export function Loading({ label = 'در حال بارگذاری…' }: { label?: string }) {
  return (
    <div className="loading-block">
      <span className="spinner" />
      {label}
    </div>
  );
}

export function Empty({ children, icon = 'search' }: { children: ReactNode; icon?: IconName }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      {children}
    </div>
  );
}

export function Alert({ tone, children }: { tone: 'warning' | 'danger' | 'info' | 'success'; children: ReactNode }) {
  const icon: IconName = tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert';
  return (
    <div className={`alert ${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div style={{ padding: 16 }}>
      <Alert tone="danger">
        {(error as Error)?.message ?? 'خطا در دریافت اطلاعات'}{' '}
        {retry && (
          <button className="btn btn-sm" onClick={retry} style={{ marginInlineStart: 8 }}>
            تلاش مجدد
          </button>
        )}
      </Alert>
    </div>
  );
}

// ------------------------------------------------------------------ values

export const JDate = ({ v }: { v: string | null | undefined }) => (v ? <span className="num">{formatJalaliDate(v)}</span> : <span className="muted">—</span>);
export const JDateTime = ({ v }: { v: string | null | undefined }) => (v ? <span className="num">{formatJalaliDateTime(v)}</span> : <span className="muted">—</span>);
export const Code = ({ children }: { children: ReactNode }) => <span className="code">{children}</span>;

export function relativeAge(iso: string | null | undefined): string {
  if (!iso) return 'هرگز';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${toPersianDigits(Math.max(s, 0))} ثانیه پیش`;
  if (s < 3600) return `${toPersianDigits(Math.round(s / 60))} دقیقه پیش`;
  if (s < 86400) return `${toPersianDigits(Math.round(s / 3600))} ساعت پیش`;
  return `${toPersianDigits(Math.round(s / 86400))} روز پیش`;
}

// ------------------------------------------------------------------ forms

export function Field({ label, help, error, children, className }: { label: ReactNode; help?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className ?? ''}`}>
      <span>{label}</span>
      {children}
      {error ? <span className="error">{error}</span> : help ? <span className="help">{help}</span> : null}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch" style={disabled ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Jalali date picker built from three selects; value is a Gregorian key "YYYY-MM-DD". */
export function JalaliDateInput({ value, onChange, tz = DEFAULT_TIMEZONE }: { value: string; onChange: (key: string) => void; tz?: string }) {
  const [y, m, d] = value.split('-').map(Number);
  const j = jalaliOf(new Date(Date.UTC(y, m - 1, d, 12)), 'UTC');
  const nowJ = jalaliOf(new Date(), tz).jy;
  const years = Array.from({ length: 6 }, (_, i) => nowJ - 4 + i);
  const set = (jy: number, jm: number, jd: number) => onChange(jalaliToDateKey(jy, jm, Math.min(jd, jalaliMonthLength(jy, jm))));
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <select className="select" value={j.jd} onChange={(e) => set(j.jy, j.jm, Number(e.target.value))} aria-label="روز">
        {Array.from({ length: jalaliMonthLength(j.jy, j.jm) }, (_, i) => (
          <option key={i} value={i + 1}>
            {toPersianDigits(i + 1)}
          </option>
        ))}
      </select>
      <select className="select" value={j.jm} onChange={(e) => set(j.jy, Number(e.target.value), j.jd)} aria-label="ماه" style={{ minWidth: 110 }}>
        {JALALI_MONTHS.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </select>
      <select className="select" value={j.jy} onChange={(e) => set(Number(e.target.value), j.jm, j.jd)} aria-label="سال">
        {years.map((yy) => (
          <option key={yy} value={yy}>
            {toPersianDigits(yy)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Jalali date + time → ISO instant in the centre's timezone (null when cleared). */
export function JalaliDateTimeInput({ value, onChange, tz = DEFAULT_TIMEZONE }: { value: string | null; onChange: (iso: string | null) => void; tz?: string }) {
  if (!value) {
    return (
      <button type="button" className="btn btn-sm" onClick={() => onChange(new Date().toISOString())}>
        <Icon name="plus" />
        تعیین تاریخ
      </button>
    );
  }
  const d = new Date(value);
  const key = localDateKey(d, tz);
  const p = jalaliOf(d, tz);
  const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  const emit = (k: string, t: string) => {
    const [yy, mm, dd] = k.split('-').map(Number);
    const [hh, mi] = t.split(':').map(Number);
    onChange(new Date(zonedMidnight(yy, mm, dd, tz).getTime() + (hh * 60 + mi) * 60000).toISOString());
  };
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <JalaliDateInput value={key} onChange={(k) => emit(k, time)} tz={tz} />
      <input className="input ltr" type="time" value={time} onChange={(e) => emit(key, e.target.value || '00:00')} style={{ width: 110 }} />
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(null)} aria-label="حذف تاریخ">
        <Icon name="x" />
      </button>
    </div>
  );
}

export type RangePreset = 'today' | '7d' | '30d' | 'month' | 'custom';

export function presetRange(p: RangePreset, tz = DEFAULT_TIMEZONE): { from: string; to: string } {
  const now = new Date();
  const today = localDateKey(now, tz);
  if (p === 'today') return { from: today, to: today };
  if (p === '7d') return { from: localDateKey(addLocalDays(now, -6, tz), tz), to: today };
  if (p === 'month') {
    const j = jalaliOf(now, tz);
    return { from: jalaliToDateKey(j.jy, j.jm, 1), to: today };
  }
  return { from: localDateKey(addLocalDays(now, -29, tz), tz), to: today };
}

/** Date range filter: presets first, custom Jalali range behind them (dataviz interaction rules). */
export function DateRangeFilter({ value, onChange }: { value: { preset: RangePreset; from: string; to: string }; onChange: (v: { preset: RangePreset; from: string; to: string }) => void }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <Field label="بازه زمانی">
        <Segmented
          value={value.preset}
          onChange={(p) => onChange(p === 'custom' ? { ...value, preset: p } : { preset: p, ...presetRange(p) })}
          options={[
            { value: 'today', label: 'امروز' },
            { value: '7d', label: '۷ روز' },
            { value: '30d', label: '۳۰ روز' },
            { value: 'month', label: 'ماه جاری' },
            { value: 'custom', label: 'سفارشی' },
          ]}
        />
      </Field>
      {value.preset === 'custom' && (
        <>
          <Field label="از">
            <JalaliDateInput value={value.from} onChange={(from) => onChange({ ...value, from })} />
          </Field>
          <Field label="تا">
            <JalaliDateInput value={value.to} onChange={(to) => onChange({ ...value, to })} />
          </Field>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ modal & confirm

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost icon-only" onClick={onClose} aria-label="بستن">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation that requires a written reason (audited sensitive actions). */
export function ReasonDialog({
  title,
  description,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
  extra,
}: {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
  extra?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = reason.trim().length >= 5;
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            انصراف
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await onConfirm(reason.trim());
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <span className="spinner" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {description && <div className="muted" style={{ lineHeight: 1.8 }}>{description}</div>}
        {extra}
        <Field label="دلیل (الزامی، در سوابق تغییرات ثبت می‌شود)" error={err}>
          <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="حداقل ۵ نویسه" autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ toasts

interface ToastItem {
  id: number;
  text: string;
  error?: boolean;
}

const ToastCtx = createContext<{ push: (text: string, error?: boolean) => void }>({ push: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, text, error }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), error ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.error ? ' error' : ''}`}>
            <Icon name={t.error ? 'alert' : 'check'} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ------------------------------------------------------------------ pagination

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>
        {toPersianDigits(total)} مورد — صفحه {toPersianDigits(page)} از {toPersianDigits(pages)}
      </span>
      <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        قبلی
      </button>
      <button className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        بعدی
      </button>
    </div>
  );
}
