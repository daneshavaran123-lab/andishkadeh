/**
 * The existing admin panel opened from the kiosk's gear, in its own window over the kiosk.
 * - In-memory session (no "persist:" partition): token and panel data never touch the disk and
 *   are cleared when the window closes.
 * - The token is handed to the panel once, by admin-preload.ts, before the panel's scripts run;
 *   the kiosk UI never receives it.
 * - Only pages of the panel may be shown; downloads, pop-ups and permission requests are refused.
 * - The window closes when the panel logs out (it navigates to the exit URL), shows its login page
 *   (session invalid), or the session expires.
 * - A panel page that does not load (server unreachable, panel not deployed on the server) closes
 *   the window too; otherwise a full-screen window would stay with no way out until expiry.
 */
import { BrowserWindow, ipcMain, session, type IpcMainEvent } from 'electron';
import { join } from 'node:path';
import { ADMIN_KIOSK_STORAGE_KEY, ADMIN_TOKEN_STORAGE_KEY, type AdminKioskSession } from '@andishkadeh/shared';
import { panelUrls } from '../src/core/admin-access';

/** sessionStorage entries for the panel, per window (webContents id). */
const handoffs = new Map<number, { entries: Array<[string, string]>; isPanel: (url: string) => boolean }>();
let registered = false;

/**
 * Answered once per window, and only to the panel page itself: the preload also runs in the
 * window's initial empty document, which must not consume the token. A reload of the panel keeps
 * the token in its own sessionStorage.
 */
function registerHandoff() {
  if (registered) return;
  registered = true;
  ipcMain.on('kiosk-admin:handoff', (e: IpcMainEvent) => {
    const h = handoffs.get(e.sender.id);
    const frame = e.senderFrame;
    if (!h || !frame || frame !== e.sender.mainFrame || !h.isPanel(frame.url)) {
      e.returnValue = null;
      return;
    }
    handoffs.delete(e.sender.id);
    e.returnValue = h.entries;
  });
}

export interface AdminWindowOptions {
  parent: BrowserWindow | null;
  kioskMode: boolean;
  panelBase: string;
  startUrl: string;
  token: string;
  expiresAt: string;
  idleMinutes: number;
  /** `message`: why the panel could not be shown (unset after a normal logout or expiry). */
  onClosed: (message?: string) => void;
}

const UNAVAILABLE = 'پنل مدیریت باز نشد؛ اتصال به سرور و نصب پنل روی سرور را بررسی کنید';

export function openAdminWindow(o: AdminWindowOptions): BrowserWindow {
  registerHandoff();
  const urls = panelUrls(o.panelBase);
  const partition = `kiosk-admin-${Date.now()}`;
  const ses = session.fromPartition(partition);
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.on('will-download', (e) => e.preventDefault());

  const w = new BrowserWindow({
    parent: o.parent ?? undefined,
    modal: !!o.parent,
    width: 1080,
    height: 1920,
    backgroundColor: '#f4f6fb',
    fullscreen: o.kioskMode,
    frame: !o.kioskMode,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'admin-preload.js'),
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !o.kioskMode,
      spellcheck: false,
    },
  });
  const id = w.webContents.id;
  const kiosk: AdminKioskSession = { returnUrl: urls.exit, idleMinutes: o.idleMinutes, expiresAt: o.expiresAt };
  handoffs.set(id, {
    entries: [
      [ADMIN_TOKEN_STORAGE_KEY, o.token],
      [ADMIN_KIOSK_STORAGE_KEY, JSON.stringify(kiosk)],
    ],
    isPanel: urls.isPanel,
  });

  let failure: string | undefined;
  const close = (message?: string) => {
    failure ??= message;
    if (!w.isDestroyed()) w.close();
  };
  w.once('ready-to-show', () => w.show());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e, url) => {
    if (urls.isExit(url)) {
      e.preventDefault();
      close();
    } else if (!urls.isPanel(url)) e.preventDefault();
  });
  w.webContents.on('will-redirect', (e, url) => {
    if (!urls.isPanel(url)) e.preventDefault();
  });
  // The panel shows its own login page only when the session is no longer valid: back to the kiosk.
  const onPage = (url: string) => {
    if (urls.isLogin(url)) close();
  };
  w.webContents.on('did-navigate', (_e, url, status) => (status >= 400 ? close(UNAVAILABLE) : onPage(url)));
  w.webContents.on('did-navigate-in-page', (_e, url) => onPage(url));
  // -3 (ERR_ABORTED) is a navigation refused above, not a failure.
  w.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) close(UNAVAILABLE);
  });
  w.webContents.on('before-input-event', (e, input) => {
    if (!o.kioskMode) return;
    const k = input.key.toLowerCase();
    if ((input.control || input.meta) && ['r', 'w', 'q', 'n', 't', 'p', 'shift'].includes(k)) e.preventDefault();
    if (['f5', 'f11', 'f12'].includes(k)) e.preventDefault();
    if (input.alt && k === 'f4') e.preventDefault();
  });
  w.webContents.on('render-process-gone', () => close(UNAVAILABLE));

  // Safety net: the panel logs out by itself at expiry; the window closes a moment later regardless.
  const expiry = setTimeout(() => close(), Math.max(0, Date.parse(o.expiresAt) - Date.now()) + 5000);
  w.on('closed', () => {
    clearTimeout(expiry);
    handoffs.delete(id);
    void ses.clearStorageData().catch(() => undefined);
    o.onClosed(failure);
  });

  void w.loadURL(o.startUrl);
  return w;
}
