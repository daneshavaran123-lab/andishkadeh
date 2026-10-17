import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { Alert, Field, useAction } from '../components/ui';

/** A01 — sign in. The server locks an account temporarily after repeated failures. */
export function Login() {
  const action = useAction();
  const { user, login, notice } = useAuth();
  const loc = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to={(loc.state as { from?: string } | null)?.from ?? '/dashboard'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-side">
        <h2>اندیشکده کشتی ایران</h2>
        <p style={{ color: '#b9c8de', lineHeight: 1.9, maxWidth: 440 }}>
          مدیریت کاتالوگ خدمات، تعرفه‌ها، تخفیف‌ها، اشتراک‌ها، فروش و وضعیت کیوسک سلف‌سرویس.
        </p>
      </div>
      <div className="login-form">
        <form className="card" onSubmit={action(submit)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22 }}>ورود به پنل مدیریت</h1>
            <p className="muted" style={{ margin: '6px 0 0' }}>با نام کاربری و رمز عبور خود وارد شوید.</p>
          </div>
          {notice && <Alert tone="warning">{notice}</Alert>}
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="نام کاربری">
            <input className="input ltr" style={{ display: 'block' }} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required name="username" />
          </Field>
          <Field label="رمز عبور">
            <input className="input ltr" style={{ display: 'block' }} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required name="password" />
          </Field>
          <button className="btn btn-primary" type="submit" disabled={busy || !username || !password}>
            {busy && <span className="spinner" />}
            ورود
          </button>
        </form>
      </div>
    </div>
  );
}
