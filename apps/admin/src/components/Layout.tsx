import { useCallback, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABEL, toPersianDigits, type DashboardResponse } from '@andishkadeh/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { kioskSession, useKioskSessionTimers } from '../kiosk';
import { ChangePasswordDialog } from '../pages/Users';
import { Icon, type IconName } from './Icon';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  adminOnly?: boolean;
  badge?: (d: DashboardResponse | undefined) => number;
}

/** No reservation / booking entries exist anywhere in the navigation (PRD A-07). */
const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'نمای کلی',
    items: [
      { to: '/dashboard', label: 'داشبورد', icon: 'dashboard' },
      { to: '/reports', label: 'گزارش‌ها', icon: 'chart' },
    ],
  },
  {
    group: 'فروش',
    items: [
      { to: '/orders', label: 'سفارش‌ها', icon: 'cart', badge: (d) => d?.alerts.conflicts ?? 0 },
      { to: '/payments', label: 'پرداخت‌ها', icon: 'card', badge: (d) => d?.alerts.unknownPayments ?? 0 },
      { to: '/subscriptions', label: 'اشتراک‌ها', icon: 'qr' },
    ],
  },
  {
    group: 'کاتالوگ',
    items: [
      { to: '/catalog/services', label: 'خدمات و تعرفه‌ها', icon: 'list' },
      { to: '/catalog/categories', label: 'حوزه‌ها و زیرگروه‌ها', icon: 'layers' },
      { to: '/plans', label: 'پلن‌های اشتراک', icon: 'crown' },
      { to: '/discounts', label: 'تخفیف‌ها', icon: 'tag' },
      { to: '/media', label: 'رسانه‌ها', icon: 'image' },
      { to: '/content', label: 'محتوای کیوسک', icon: 'content' },
    ],
  },
  {
    group: 'عملیات',
    items: [
      { to: '/devices', label: 'کیوسک و تجهیزات', icon: 'monitor', badge: (d) => (d?.alerts.hardwareErrors ?? 0) + (d?.alerts.staleDevices ?? 0) },
      { to: '/sync', label: 'همگام‌سازی', icon: 'sync', badge: (d) => d?.alerts.syncRejected ?? 0 },
    ],
  },
  {
    group: 'مدیریت',
    items: [
      { to: '/settings', label: 'تنظیمات', icon: 'settings' },
      { to: '/users', label: 'کاربران و نقش‌ها', icon: 'users', adminOnly: true },
      { to: '/audit', label: 'سوابق تغییرات', icon: 'history', adminOnly: true },
    ],
  },
];

export function Layout() {
  const { user, isAdmin, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState(false);
  const loc = useLocation();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardResponse>('/admin/dashboard'), refetchInterval: 60_000 });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ centerName: string }>('/admin/settings') });
  const onKiosk = !!kioskSession();
  useKioskSessionTimers(useCallback(() => logout(), [logout]));

  return (
    <div className="app">
      <aside className={`sidebar${open ? ' open' : ''}`} onClick={() => setOpen(false)}>
        <div className="brand">
          <span className="brand-mark">ا</span>
          <span>
            <b>پنل مدیریت</b>
            <small>{settings.data?.centerName ?? 'اندیشکده کشتی ایران'}</small>
          </span>
        </div>
        <nav className="nav" aria-label="منوی اصلی">
          {NAV.map((g) => {
            const items = g.items.filter((i) => !i.adminOnly || isAdmin);
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="nav-group">{g.group}</div>
                {items.map((i) => {
                  const n = i.badge?.(dash.data) ?? 0;
                  return (
                    <NavLink key={i.to} to={i.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                      <Icon name={i.icon} />
                      {i.label}
                      {n > 0 && <span className="count">{toPersianDigits(n)}</span>}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost icon-only menu-toggle" onClick={() => setOpen(true)} aria-label="منو">
            <Icon name="menu" />
          </button>
          <span className="center">{settings.data?.centerName ?? 'اندیشکده کشتی ایران'}</span>
          {onKiosk && (
            <span className="badge warning" title="پس از چند دقیقه بی‌فعالیتی، خروج خودکار و بازگشت به کیوسک" data-testid="kiosk-mode">
              روی کیوسک
            </span>
          )}
          <span className="spacer" />
          {user && (
            <div className="user-chip">
              <span className="avatar">{user.displayName.slice(0, 1)}</span>
              <span className="user-name">
                <b>{user.displayName}</b>{' '}
                <span className={`badge ${isAdmin ? 'info' : ''}`}>{ROLE_LABEL[user.role]}</span>
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => setPwd(true)} aria-label="تغییر رمز">
                <Icon name="key" />
                <span className="btn-label">تغییر رمز</span>
              </button>
              <button className="btn btn-sm" onClick={() => logout()} data-testid="logout">
                <Icon name="logout" />
                {onKiosk ? 'خروج و بازگشت به کیوسک' : 'خروج'}
              </button>
            </div>
          )}
        </header>
        <main className="content" key={loc.pathname}>
          <Outlet />
        </main>
      </div>
      {pwd && <ChangePasswordDialog onClose={() => setPwd(false)} />}
    </div>
  );
}

export function ReadOnlyNote({ children }: { children?: ReactNode }) {
  const { isAdmin } = useAuth();
  if (isAdmin) return null;
  return (
    <div className="alert info" style={{ marginBottom: 16 }}>
      <Icon name="lock" />
      <div>{children ?? 'دسترسی شما در این بخش فقط مشاهده است؛ تغییر تعرفه، تخفیف و تنظیمات فقط توسط مدیر اصلی انجام می‌شود.'}</div>
    </div>
  );
}
