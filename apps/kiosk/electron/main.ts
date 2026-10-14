/**
 * Electron main process of the kiosk.
 * Security (PRD §18): contextIsolation, sandboxed renderer, no Node in the UI, IPC allowlist,
 * navigation/new-window blocked, device secrets only in this process.
 * Lifecycle: fullscreen kiosk window, renderer crash → reload, single instance, no sleep.
 */
import { app, BrowserWindow, ipcMain, net, powerSaveBlocker, protocol, session } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/core/config';
import { KioskCore } from '../src/core/kiosk-core';
import { IPC_CHANNELS, IPC_EVENTS, type IpcChannel } from '../src/core/types';
import { WindowsDriverPrinter } from './printer-windows';

protocol.registerSchemesAsPrivileged([
  { scheme: 'kiosk-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Fixed, documented location (kiosk.config.json, SQLite, media cache, receipts): %APPDATA%\AndishkadehKiosk
const dataDir = process.env.KIOSK_DATA_DIR ?? join(app.getPath('appData'), 'AndishkadehKiosk');
const cfg = loadConfig(dataDir, { appVersion: app.getVersion() });
let core: KioskCore;
let win: BrowserWindow | null = null;

const rendererUrl = process.env.KIOSK_RENDERER_URL; // dev only (vite dev server)
const rendererFile = join(__dirname, '../dist-renderer/index.html');

function isTrustedSender(url: string): boolean {
  if (rendererUrl) return url.startsWith(rendererUrl);
  return url.startsWith(pathToFileURL(join(__dirname, '../dist-renderer')).toString());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 1920,
    backgroundColor: '#050B18',
    fullscreen: cfg.kioskMode,
    kiosk: cfg.kioskMode,
    frame: !cfg.kioskMode,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !cfg.kioskMode,
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
    if (!cfg.kioskMode) return;
    const k = input.key.toLowerCase();
    if ((input.control || input.meta) && ['r', 'w', 'q', 'n', 't', 'p', '=', '-', '0', 'shift'].includes(k)) e.preventDefault();
    if (['f5', 'f11', 'f12'].includes(k)) e.preventDefault();
    if (input.alt && k === 'f4') e.preventDefault();
  });
  win.webContents.on('render-process-gone', () => setTimeout(() => win?.reload(), 1500));
  win.on('unresponsive', () => setTimeout(() => win?.reload(), 10_000));
  if (rendererUrl) void win.loadURL(rendererUrl);
  else void win.loadFile(rendererFile);
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  powerSaveBlocker.start('prevent-display-sleep');

  core = new KioskCore(cfg, {
    mediaBase: 'kiosk-media://media',
    printer: cfg.adapters.printer === 'windows' ? new WindowsDriverPrinter(cfg.adapters.printerName) : undefined,
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
      return core.handle(channel as IpcChannel, req as never);
    });
  }
  for (const ev of IPC_EVENTS) core.on(ev, (data) => win?.webContents.send(`kiosk:event:${ev}`, data));

  core.start();
  createWindow();

  if (app.isPackaged && cfg.kioskMode) {
    app.setLoginItemSettings({ openAtLogin: true });
  }
});

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
