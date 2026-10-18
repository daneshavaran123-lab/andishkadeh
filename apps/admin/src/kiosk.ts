/**
 * Kiosk mode of the panel: set when a staff member signed in from a kiosk's gear (the kiosk writes
 * the session into sessionStorage, see packages/shared/src/kiosk-admin.ts). The panel then logs out
 * after a few idle minutes or at the session's end, and returns to the kiosk instead of showing
 * its own login page. Without that entry the panel behaves exactly as before.
 */
import { useEffect } from 'react';
import { ADMIN_KIOSK_STORAGE_KEY, type AdminKioskSession } from '@andishkadeh/shared';

export function kioskSession(): AdminKioskSession | null {
  try {
    const raw = sessionStorage.getItem(ADMIN_KIOSK_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<AdminKioskSession>;
    // Only a page of this origin: the entry can never turn the panel into an open redirect.
    const back = typeof s.returnUrl === 'string' ? new URL(s.returnUrl, location.href) : null;
    if (!back || back.origin !== location.origin || typeof s.idleMinutes !== 'number' || typeof s.expiresAt !== 'string') return null;
    return { returnUrl: back.href, idleMinutes: s.idleMinutes, expiresAt: s.expiresAt };
  } catch {
    return null;
  }
}

/** Ends kiosk mode and goes back to the kiosk (Windows app: the window closes; web app: /kiosk/). */
export function returnToKiosk(s: AdminKioskSession) {
  sessionStorage.removeItem(ADMIN_KIOSK_STORAGE_KEY);
  location.replace(s.returnUrl);
}

/** Calls `onEnd` after `idleMinutes` without a touch, click or key press, and at the session's end. */
export function useKioskSessionTimers(onEnd: () => void) {
  useEffect(() => {
    const s = kioskSession();
    if (!s) return;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const restart = () => {
      clearTimeout(idle);
      idle = setTimeout(onEnd, s.idleMinutes * 60_000);
    };
    const end = setTimeout(onEnd, Math.max(0, Date.parse(s.expiresAt) - Date.now()));
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, restart, { passive: true }));
    restart();
    return () => {
      clearTimeout(idle);
      clearTimeout(end);
      events.forEach((e) => window.removeEventListener(e, restart));
    };
  }, [onEnd]);
}
