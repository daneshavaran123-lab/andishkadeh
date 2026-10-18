import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { formatNumberFa, formatToman, toPersianDigits } from '@andishkadeh/shared';
import { platform } from '../bridge';
import { Icon } from './Icon';
import { cartPreview, useApp, useSession } from '../store';

export function Screen({
  title,
  subtitle,
  onBack,
  actions = true,
  footer,
  children,
  theme,
  calm,
  center,
  bodyStyle,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  onBack?: (() => void) | null;
  /** show help / cancel actions (K24) */
  actions?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  theme?: string;
  calm?: boolean;
  /** vertically centre the content (status / result screens) */
  center?: boolean;
  bodyStyle?: CSSProperties;
}) {
  const back = useSession((s) => s.back);
  const backHandler = onBack === undefined ? back : onBack;
  return (
    <div className={`screen page-enter${calm ? ' calm' : ''}`} data-theme={theme}>
      {(title || backHandler) && (
        <header className="topbar">
          {backHandler && (
            <button className="icon-btn" onClick={backHandler} aria-label="بازگشت" data-testid="back">
              <Icon name="back" />
            </button>
          )}
          <div className="title-block">
            {title && <h1>{title}</h1>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <TopActions />}
        </header>
      )}
      <main className={`body${center ? ' center' : ''}`} style={bodyStyle}>
        {children}
      </main>
      {footer && <footer className="footer">{footer}</footer>}
    </div>
  );
}

function TopActions() {
  return (
    <div className="top-actions">
      <button className="pill-btn" onClick={() => window.dispatchEvent(new CustomEvent('kiosk:help'))} data-testid="help">
        <Icon name="help" />
        راهنما
      </button>
    </div>
  );
}

export function Price({ final, was, unit }: { final: number; was?: number | null; unit?: string }) {
  return (
    <div className="price">
      {was && was > final ? <span className="was">{formatNumberFa(was)}</span> : null}
      <span className="final">{formatToman(final)}</span>
      {unit && <span className="unit">هر {unit}</span>}
    </div>
  );
}

export function CartBar() {
  const cart = useSession((s) => s.cart);
  const go = useSession((s) => s.go);
  const bootstrap = useApp((s) => s.bootstrap);
  if (!cart.length) return null;
  const p = cartPreview(bootstrap, cart);
  return (
    <button className="cartbar" onClick={() => go('cart')} data-testid="cartbar">
      <Icon name="cart" />
      <span className="count">{toPersianDigits(p.count)}</span>
      <span>مشاهده سبد خرید</span>
      <span className="total">{formatToman(p.total)}</span>
      <Icon name="chevron" />
    </button>
  );
}

export function Stepper({ value, min = 1, max, onChange }: { value: number; min?: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="افزایش">
        <Icon name="plus" />
      </button>
      <span className="qty">{toPersianDigits(value)}</span>
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="کاهش">
        <Icon name="minus" />
      </button>
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="در حال پردازش" />;
}

export function QrCode({ value }: { value: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    void QRCode.toString(value, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 }).then(setSvg);
  }, [value]);
  // The raw value is exposed as an attribute only in the dev bridge (E2E); never in the Electron build.
  return (
    <div
      className="qr-box"
      role="img"
      aria-label="کد QR کارت عضویت"
      data-testid="qr"
      data-value={platform === 'web-dev' ? value : undefined}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function Notice({ tone, icon = 'alert', children }: { tone: 'amber' | 'blue' | 'red' | 'green'; icon?: Parameters<typeof Icon>[0]['name']; children: ReactNode }) {
  return (
    <div className={`notice ${tone}`}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

/** Public web app (browsing only): where buying happens. */
export function BuyAtKioskNotice() {
  return (
    <Notice tone="blue" icon="cart">
      <span data-testid="buy-at-kiosk">خرید، پرداخت و دریافت کد عضویت در کیوسک‌های مرکز انجام می‌شود. این‌جا خدمات، تعرفه‌ها و پلن‌های اشتراک را ببینید.</span>
    </Notice>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export function NumPad({ onDigit, onBackspace, onClear }: { onDigit: (d: string) => void; onBackspace: () => void; onClear: () => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div className="numpad" dir="ltr">
      {keys.map((k) => (
        <button key={k} onClick={() => onDigit(k)} data-testid={`key-${k}`}>
          {toPersianDigits(k)}
        </button>
      ))}
      <button className="fn" onClick={onClear} data-testid="key-clear">
        پاک کردن
      </button>
      <button onClick={() => onDigit('0')} data-testid="key-0">
        {toPersianDigits('0')}
      </button>
      <button onClick={onBackspace} aria-label="حذف رقم" data-testid="key-back">
        <Icon name="backspace" />
      </button>
    </div>
  );
}

const FA_ROWS = [
  ['ض', 'ص', 'ث', 'ق', 'ف', 'غ', 'ع', 'ه', 'خ', 'ح', 'ج', 'چ'],
  ['ش', 'س', 'ی', 'ب', 'ل', 'ا', 'ت', 'ن', 'م', 'ک', 'گ'],
  ['ظ', 'ط', 'ز', 'ر', 'ذ', 'د', 'پ', 'و', 'ژ', 'آ'],
];
const EN_ROW = ['P', 'N', 'S', 'E', 'F', 'B', 'V', 'R', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Minimal on-screen keyboard for the service search (no physical keyboard on the kiosk). */
export function SearchKeyboard({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone: () => void }) {
  return (
    <div className="kbd" data-testid="keyboard">
      {FA_ROWS.map((row, i) => (
        <div className="kbd-row" key={i}>
          {row.map((k) => (
            <button key={k} onClick={() => onChange(value + k)}>
              {k}
            </button>
          ))}
        </div>
      ))}
      <div className="kbd-row" dir="ltr">
        {EN_ROW.map((k) => (
          <button key={k} onClick={() => onChange(value + k)} style={{ minWidth: 48, fontSize: 24 }}>
            {/\d/.test(k) ? toPersianDigits(k) : k}
          </button>
        ))}
      </div>
      <div className="kbd-row">
        <button className="wide" onClick={() => onChange(value + ' ')}>
          فاصله
        </button>
        <button onClick={() => onChange(value.slice(0, -1))} aria-label="حذف">
          <Icon name="backspace" style={{ width: 36, height: 36 }} />
        </button>
        <button onClick={() => onChange('')}>پاک</button>
        <button onClick={onDone} style={{ background: 'var(--blue)', minWidth: 160 }}>
          تأیید
        </button>
      </div>
    </div>
  );
}

export function Toast() {
  const toast = useSession((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="toast" role="status">
      <Icon name="check" />
      {toast}
    </div>
  );
}
