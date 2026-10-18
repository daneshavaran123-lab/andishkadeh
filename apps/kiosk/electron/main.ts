/**
 * Electron main process of the kiosk.
 * Security (PRD §18): contextIsolation, sandboxed renderer, no Node in the UI, IPC allowlist,
 * navigation/new-window blocked, device secrets only in this process.
 * Lifecycle: fullscreen kiosk window, renderer crash → reload, single instance, no sleep.
 * First run (no kiosk.config.json): the setup screen asks for the server address and device key,
 * writes the file and restarts the app.
 * Staff: the gear on the welcome screen signs in and opens the existing admin panel in its own
 * window (admin-window.ts); the kiosk returns to its welcome screen and syncs when it closes.
 */
import { app, BrowserWindow, ipcMain, net, powerSaveBlocker, protocol, session } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { KioskConfig } from '../src/core/config';
import type { KioskCore } from '../src/core/kiosk-core';
import { adminPanelBase, type AdminLoginResult } from '../src/core/admin-access';
import { verifySetup } from '../src/core/setup-check';
import { IPC_CHANNELS, IPC_EVENTS, type IpcChannel } from '../src/core/types';
import { createNodeCore, isConfigured, loadConfig, writeSetupConfig } from '../src/platform/node';
import { openAdminWindow } from './admin-window';
import { WindowsDriverPrinter } from './printer-windows';

protocol.registerSchemesAsPrivileged([
  { scheme: 'kiosk-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// A second copy must not touch the database: it exits at once and the running kiosk takes focus.
const primary = app.requestSingleInstanceLock();
if (!primary) app.exit(0);

// Fixed, documented location (kiosk.config.json, SQLite, media cache, receipts): %APPDATA%\AndishkadehKiosk
const dataDir = process.env.KIOSK_DATA_DIR ?? join(app.getPath('appData'), 'AndishkadehKiosk');
let cfg: KioskConfig;
let core: KioskCore;
let win: BrowserWindow | null = null;
let adminWin: BrowserWindow | null = null;

const rendererUrl = process.env.KIOSK_RENDERER_URL; // dev only (vite dev server)
const rendererFile = join(__dirname, '../dist-renderer/index.html');

function isTrustedSender(url: string): boolean {
  if (rendererUrl) return url.startsWith(rendererUrl);
  return url.startsWith(pathToFileURL(join(__dirname, '../dist-renderer')).toString());
}

function createWindow(kioskMode: boolean, search = '') {
  win = new BrowserWindow({
    width: 1080,
    height: 1920,
    backgroundColor: '#050B18',
    fullscreen: kioskMode,
    kiosk: kioskMode,
    frame: !kioskMode,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !kioskMode,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!isTrustedSender(url)) e.preventDefault();
  });
  // Block reload / devtools / zoom shortcuts on the kiosk.
  win.webContents.on('before-input-event', (e, input) => {
    if (!kioskMode) return;
    const k = input.key.toLowerCase();
    if ((input.control || input.meta) && ['r', 'w', 'q', 'n', 't', 'p', '=', '-', '0', 'shift'].includes(k)) e.preventDefault();
    if (['f5', 'f11', 'f12'].includes(k)) e.preventDefault();
    if (input.alt && k === 'f4') e.preventDefault();
  });
  win.webContents.on('render-process-gone', () => setTimeout(() => win?.reload(), 1500));
  win.on('unresponsive', () => setTimeout(() => win?.reload(), 10_000));
  if (rendererUrl) void win.loadURL(`${rendererUrl}${search ? `?${search}` : ''}`);
  else void win.loadFile(rendererFile, { search });
}

if (primary) void app.whenReady().then(() => (isConfigured(dataDir) ? start() : setup()));

/** First run: the setup screen collects the server address and device key, then the app restarts. */
function setup() {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (!isTrustedSender(event.senderFrame?.url ?? '')) throw new Error('untrusted sender');
  };
  ipcMain.handle('kiosk-setup:printers', async (event) => {
    trusted(event);
    return ((await win?.webContents.getPrintersAsync()) ?? []).map((p) => p.name);
  });
  ipcMain.handle('kiosk-setup:verify', (event, s: { serverUrl: string; deviceId: string; deviceKey: string }) => {
    trusted(event);
    return verifySetup(s);
  });
  ipcMain.handle('kiosk-setup:save', (event, values: unknown) => {
    trusted(event);
    writeSetupConfig(dataDir, values);
    // Answer the page first, then start again with the new configuration.
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 300);
    return { ok: true };
  });
  createWindow(app.isPackaged, 'setup');
}

async function start() {
  cfg = loadConfig(dataDir, { appVersion: app.getVersion() });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  powerSaveBlocker.start('prevent-display-sleep');

  core = createNodeCore(cfg, {
    mediaBase: 'kiosk-media://media',
    printer: cfg.adapters.printer === 'windows' ? new WindowsDriverPrinter(cfg.adapters.printerName, () => win?.webContents ?? null) : undefined,
  });

  protocol.handle('kiosk-media', async (request) => {
    const checksum = new URL(request.url).pathname.replace(/^\//, '').replace(/[^a-f0-9]/g, '');
    const file = core.catalog.mediaPath(checksum);
    if (!file) return new Response(null, { status: 404 });
    return net.fetch(pathToFileURL(file.path).toString());
  });

  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(`kiosk:${channel}`, async (event, req) => {
      if (!isTrustedSender(event.senderFrame?.url ?? '')) throw new Error('untrusted sender');
      if (channel === 'dev:control' && !cfg.devControls) return { ok: false, message: 'dev controls disabled' };
      if (channel === 'admin:login') return openAdminPanel(req);
      return core.handle(channel as IpcChannel, req as never);
    });
  }
  for (const ev of IPC_EVENTS) core.on(ev, (data) => win?.webContents.send(`kiosk:event:${ev}`, data));

  core.start();
  createWindow(cfg.kioskMode);

  if (app.isPackaged && cfg.kioskMode) {
    app.setLoginItemSettings({ openAtLogin: true });
  }
}

/** Gear on the welcome screen: sign in, then show the existing admin panel over the kiosk. */
async function openAdminPanel(req: unknown): Promise<AdminLoginResult> {
  if (adminWin) {
    adminWin.focus();
    return { ok: false, code: 'ALREADY_OPEN', message: 'پنل مدیریت هم‌اکنون باز است' };
  }
  const r = await core.handle('admin:login', req as never);
  if (!r.ok || !r.token) return r.ok ? { ok: false, code: 'ERROR', message: 'ورود انجام نشد' } : r;
  const { token, ...reply } = r;
  adminWin = openAdminWindow({
    parent: win,
    kioskMode: cfg.kioskMode,
    panelBase: adminPanelBase(cfg),
    startUrl: r.startUrl,
    token,
    expiresAt: r.expiresAt,
    idleMinutes: r.idleMinutes,
    onClosed: (message) => {
      adminWin = null;
      win?.focus();
      win?.webContents.send('kiosk:event:admin', { open: false, message });
      // Prices, services, plans and subscriptions changed in the panel reach the kiosk at once.
      void core.sync.cycle().catch(() => undefined);
    },
  });
  // The token stays in the main process and the panel window; the kiosk UI only learns who signed in.
  return reply;
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  core?.stop();
  app.quit();
});
