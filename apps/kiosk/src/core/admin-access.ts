/**
 * Staff sign-in from the kiosk (gear on the welcome screen). The kiosk never stores the password:
 * it is sent once to the server, which answers with a short session (KIOSK_ADMIN_SESSION_MINUTES)
 * for the existing admin panel. The host then opens the panel (Electron: its own window; web app:
 * the same tab) and the panel returns to the kiosk on logout, idle timeout or expiry.
 */
import { adminStartPath, type AdminRole, type LoginResponse } from '@andishkadeh/shared';
import { ApiResponseError, type ApiClient } from './api-client';
import type { KioskConfig } from './config';

export interface AdminLoginRequest {
  username: string;
  password: string;
}

export type AdminLoginResult =
  | {
      ok: true;
      user: { displayName: string; role: AdminRole };
      /** Panel page for the role (dashboard or orders). */
      startUrl: string;
      expiresAt: string;
      idleMinutes: number;
      /** Session token. Stripped by the Windows app before the reply reaches the kiosk UI. */
      token?: string;
    }
  | { ok: false; code: string; message: string };

/** Base URL of the existing admin panel, without a trailing slash. */
export function adminPanelBase(cfg: Pick<KioskConfig, 'serverUrl' | 'adminPanelUrl'>): string {
  return (cfg.adminPanelUrl ?? `${cfg.serverUrl.replace(/\/+$/, '')}/admin`).replace(/\/+$/, '');
}

/** Pages of the panel the kiosk window may show, its login page and the exit URL used on logout. */
export function panelUrls(base: string) {
  const root = base.replace(/\/+$/, '');
  const exit = `${root}/kiosk-exit`;
  const path = (url: string) => {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
    } catch {
      return '';
    }
  };
  return {
    exit,
    isExit: (url: string) => path(url) === exit,
    isLogin: (url: string) => path(url) === `${root}/login`,
    isPanel: (url: string) => {
      const p = path(url);
      return p === root || p.startsWith(`${root}/`);
    },
  };
}

export async function adminLogin(api: ApiClient, cfg: KioskConfig, req: AdminLoginRequest): Promise<AdminLoginResult> {
  const username = typeof req?.username === 'string' ? req.username.trim() : '';
  const password = typeof req?.password === 'string' ? req.password : '';
  if (!username || !password || username.length > 40 || password.length > 200) {
    return { ok: false, code: 'VALIDATION_FAILED', message: 'نام کاربری و رمز عبور را وارد کنید' };
  }
  try {
    const res = await api.post<LoginResponse>('/admin/auth/login', { username, password, client: 'kiosk' });
    return {
      ok: true,
      user: { displayName: res.user.displayName, role: res.user.role },
      startUrl: `${adminPanelBase(cfg)}${adminStartPath(res.user.role)}`,
      expiresAt: res.expiresAt,
      idleMinutes: cfg.adminIdleMinutes,
      token: res.token,
    };
  } catch (e) {
    if (e instanceof ApiResponseError && e.status < 500) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: 'NETWORK', message: 'ارتباط با مرکز برقرار نیست؛ ورود مدیر فقط با اتصال به مرکز ممکن است' };
  }
}
