/**
 * Admin access from the kiosk (gear on its welcome screen). The kiosk signs the staff member in
 * and opens the existing admin panel; these sessionStorage keys hand the session over to the panel.
 */
import { AdminRole } from './enums';

/** Panel session token (apps/admin/src/api.ts reads it from sessionStorage). */
export const ADMIN_TOKEN_STORAGE_KEY = 'andishkadeh.admin.token';
/** Present only when the panel was opened from a kiosk; makes the panel return to it. */
export const ADMIN_KIOSK_STORAGE_KEY = 'andishkadeh.admin.kiosk';

export interface AdminKioskSession {
  /** Where the panel goes after logout, idle timeout or expiry (same origin as the panel). */
  returnUrl: string;
  /** Logout after this many minutes without a touch or key press. */
  idleMinutes: number;
  /** Absolute end of the session (the token expires at the same moment). */
  expiresAt: string;
}

/** First page of the panel for each role: managers see the dashboard, reception staff the orders. */
export function adminStartPath(role: AdminRole): string {
  return role === AdminRole.ADMIN ? '/dashboard' : '/orders';
}
