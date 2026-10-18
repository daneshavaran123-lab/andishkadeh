import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AdminRole, type AdminUserDto, type LoginResponse } from '@andishkadeh/shared';
import { api, setUnauthorizedHandler, tokenStore } from './api';
import { kioskSession, returnToKiosk } from './kiosk';

interface AuthState {
  user: AdminUserDto | null;
  loading: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: (reason?: string) => void;
  notice: string | null;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUserDto | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.get());
  const [notice, setNotice] = useState<string | null>(null);

  const logout = useCallback((reason?: string) => {
    tokenStore.clear();
    // Opened from a kiosk: logout, idle timeout and expiry all go back to the kiosk.
    const kiosk = kioskSession();
    if (kiosk) return returnToKiosk(kiosk);
    setUser(null);
    setNotice(reason ?? null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => logout('نشست شما منقضی شده است؛ لطفاً دوباره وارد شوید.'));
    if (!tokenStore.get()) {
      const kiosk = kioskSession();
      if (kiosk) returnToKiosk(kiosk);
      return;
    }
    api
      .get<AdminUserDto>('/admin/auth/me')
      .then(setUser)
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [logout]);

  const login = async (username: string, password: string) => {
    const res = await api.post<LoginResponse>('/admin/auth/login', { username, password });
    tokenStore.set(res.token);
    setNotice(null);
    setUser(res.user);
  };

  return (
    <Ctx.Provider value={{ user, loading, isAdmin: user?.role === AdminRole.ADMIN, login, logout, notice }}>{children}</Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider missing');
  return v;
}

/** Renders children only for ADMIN users (UI convenience; the API enforces RBAC regardless). */
export function AdminOnly({ children }: { children: ReactNode }) {
  return useAuth().isAdmin ? <>{children}</> : null;
}
