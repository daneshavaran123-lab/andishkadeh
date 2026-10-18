import { z } from 'zod';

/**
 * Kiosk configuration. Each platform has its own loader:
 *  - Electron / Node (platform/node/config.ts): defaults → <dataDir>/kiosk.config.json → KIOSK_* env vars.
 *  - Web app / Android (platform/web/config.ts): entered once on the setup screen, kept on the device.
 * The device key is a secret: it is never part of any build output.
 */
export const KioskConfigSchema = z.object({
  serverUrl: z.string().url(),
  deviceId: z.string().min(1),
  deviceKey: z.string().min(8),
  /** Folder for the SQLite file, media cache and receipts (Electron); a storage name in the web app. */
  dataDir: z.string(),
  appVersion: z.string().default('1.0.0'),
  adapters: z.object({
    /**
     * mock = simulated card reader. none = no SDK configured (status UNKNOWN, sales blocked).
     * helper = Windows/Node only: a helper program around the bank's PC-POS SDK (docs/payment-helper.md).
     */
    payment: z.enum(['mock', 'none', 'helper']).default('mock'),
    /** helper: path of the helper executable, and its arguments (e.g. terminal IP and port). */
    paymentHelperPath: z.string().optional(),
    paymentHelperArgs: z.array(z.string()).default([]),
    /**
     * mock = simulated (receipts written to <dataDir>/receipts); windows = silent print through the
     * Windows driver (Electron); browser = system print dialog / kiosk-printing browser (web app).
     */
    printer: z.enum(['mock', 'windows', 'browser']).default('mock'),
    printerName: z.string().optional(),
    /** keyboard = USB HID scanner in keyboard-wedge mode (captured by the UI); mock = dev controls only. */
    scanner: z.enum(['keyboard', 'mock']).default('keyboard'),
  }),
  intervals: z
    .object({
      heartbeatSec: z.number().int().min(5).default(30),
      pullSec: z.number().int().min(5).default(60),
      pushSec: z.number().int().min(2).default(10),
      recoverySec: z.number().int().min(10).default(60),
    })
    .default({}),
  requestTimeoutMs: z.number().int().min(1000).default(8000),
  /** Electron only: fullscreen kiosk window without frame, menu or devtools. */
  kioskMode: z.boolean().default(true),
  /**
   * Public web app at `/` (WEB_APP_DEVICE_ID, no key): the customer sees the start screen, services,
   * prices and plans; buying and member QR checks happen at the center's kiosks.
   */
  browseOnly: z.boolean().default(false),
  /** Exposes dev controls (scenario switching) — must stay false in production builds. */
  devControls: z.boolean().default(false),
  /** Existing admin panel opened from the gear on the welcome screen; default `${serverUrl}/admin`. */
  adminPanelUrl: z.string().url().optional(),
  /** The panel opened on the kiosk logs out after this many idle minutes. */
  adminIdleMinutes: z.number().positive().max(60).default(5),
});

export type KioskConfig = z.infer<typeof KioskConfigSchema>;
