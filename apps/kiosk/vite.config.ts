import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Strict CSP for the packaged app (dev mode keeps Vite's inline HMR preamble working). */
const PROD_CSP =
  "default-src 'self'; img-src 'self' data: blob: kiosk-media:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self'";
const csp = (): Plugin => ({
  name: 'kiosk-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`),
});

// Renderer (UI) build. Loaded from file:// inside Electron, hence the relative base.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), csp()],
  resolve: {
    alias: {
      // Browser-safe entry of the shared package (TS source; never the ./node subpath here).
      '@andishkadeh/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist-renderer'),
    emptyOutDir: true,
    target: 'chrome120',
    assetsInlineLimit: 0,
  },
  server: { port: 5174, strictPort: true },
});
