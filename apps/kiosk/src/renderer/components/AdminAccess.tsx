/**
 * Staff access from the welcome screen: a small gear opens the sign-in; after the server accepts
 * the credentials the existing admin panel opens (Windows app: its own window over the kiosk;
 * web app: the same tab, which comes back here on logout). The password is never stored.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ADMIN_KIOSK_STORAGE_KEY, ADMIN_TOKEN_STORAGE_KEY, type AdminKioskSession } from '@andishkadeh/shared';
import type { AdminLoginResult } from '../../core/admin-access';
import { invoke, platform } from '../bridge';
import { Icon } from './Icon';
import { Modal } from './ui';
import { TextKeyboard } from './TextKeyboard';

/** The sign-in closes itself (and forgets what was typed) after this long without a touch. */
const IDLE_MS = 60_000;

/** Web app served by the server: hand the session to the panel in this tab (same origin only). */
function openPanelInThisTab(r: Extract<AdminLoginResult, { ok: true }>): boolean {
  const start = new URL(r.startUrl, location.href);
  if (!r.token || start.origin !== location.origin) return false;
  const kiosk: AdminKioskSession = { returnUrl: location.href.split('#')[0], idleMinutes: r.idleMinutes, expiresAt: r.expiresAt };
  sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, r.token);
  sessionStorage.setItem(ADMIN_KIOSK_STORAGE_KEY, JSON.stringify(kiosk));
  location.assign(start.href);
  return true;
}

export function AdminGear() {
  const [open, setOpen] = useState(false);
  // The Android app cannot show the server's panel inside its own WebView.
  if (platform === 'android') return null;
  return (
    <>
      <button type="button" className="admin-gear" onClick={() => setOpen(true)} aria-label="ورود مدیر" data-testid="admin-gear">
        <Icon name="gear" />
      </button>
      {open && <AdminLogin onClose={() => setOpen(false)} />}
    </>
  );
}

function AdminLogin({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [field, setField] = useState<'username' | 'password'>('username');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(0);
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(onClose, IDLE_MS);
    return () => clearTimeout(t);
  }, [touched, onClose]);

  const poke = () => setTouched((n) => n + 1);
  const edit = (fn: (v: string) => string) => {
    poke();
    setError(null);
    if (field === 'username') setUsername((v) => fn(v).slice(0, 40));
    else setPassword((v) => fn(v).slice(0, 200));
  };
  const focus = (f: 'username' | 'password') => {
    setField(f);
    (f === 'username' ? userRef : passRef).current?.focus();
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    poke();
    if (!username.trim()) return focus('username');
    if (!password) return focus('password');
    setBusy(true);
    setError(null);
    try {
      const r = await invoke('admin:login', { username: username.trim(), password });
      setPassword('');
      if (!r.ok) {
        setError(r.message);
        focus('password');
        return;
      }
      if (platform === 'electron') return onClose(); // the panel window is now open over the kiosk
      if (!openPanelInThisTab(r)) setError('پنل مدیریت در این نسخه از کیوسک باز نمی‌شود؛ از برنامه ویندوز یا نشانی ‎/admin‎ سرور استفاده کنید.');
    } catch {
      setPassword('');
      setError('ارتباط با برنامه کیوسک برقرار نشد؛ دوباره تلاش کنید.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <form className="admin-login" onSubmit={(e) => void submit(e)} onPointerDown={poke} data-testid="admin-login">
        <div className="admin-login-head">
          <span className="icon-ring" style={{ width: 88, height: 88 }}>
            <Icon name="shield" style={{ width: 44, height: 44 }} />
          </span>
          <div>
            <h2>ورود مدیر</h2>
            <p>ورود به پنل مدیریت با نام کاربری و رمز عبور. رمز روی کیوسک ذخیره نمی‌شود.</p>
          </div>
        </div>
        <label className={field === 'username' ? 'active' : ''}>
          نام کاربری
          <input
            ref={userRef}
            dir="ltr"
            inputMode="none"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onFocus={() => setField('username')}
            onChange={(e) => {
              poke();
              setError(null);
              setUsername(e.target.value.slice(0, 40));
            }}
            data-testid="admin-username"
          />
        </label>
        <label className={field === 'password' ? 'active' : ''}>
          رمز عبور
          <input
            ref={passRef}
            dir="ltr"
            type="password"
            inputMode="none"
            autoComplete="off"
            value={password}
            onFocus={() => setField('password')}
            onChange={(e) => {
              poke();
              setError(null);
              setPassword(e.target.value.slice(0, 200));
            }}
            data-testid="admin-password"
          />
        </label>
        {error && (
          <div className="admin-login-error" role="alert" data-testid="admin-login-error">
            {error}
          </div>
        )}
        <TextKeyboard onKey={(ch) => edit((v) => v + ch)} onBackspace={() => edit((v) => v.slice(0, -1))} />
        <div className="admin-login-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} data-testid="admin-cancel">
            انصراف
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="admin-submit">
            {busy ? 'در حال بررسی…' : 'ورود'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
