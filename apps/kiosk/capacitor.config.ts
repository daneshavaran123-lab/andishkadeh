import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android kiosk app: the web app build (dist-web, `pnpm build:web`) inside a native shell.
 * The page origin is https://localhost; the kiosk server is usually plain HTTP on the local
 * network, hence cleartext + mixed content. Add https://localhost to the server's CORS_ORIGINS.
 */
const config: CapacitorConfig = {
  appId: 'ir.andishkadeh.kiosk',
  appName: 'کیوسک اندیشکده',
  webDir: 'dist-web',
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#050b18',
    captureInput: false,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
