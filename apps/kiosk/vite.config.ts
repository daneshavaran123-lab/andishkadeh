import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

/** Strict CSP for the packaged Electron app (dev mode keeps Vite's inline HMR preamble working). */
const ELECTRON_CSP =
  "default-src 'self'; img-src 'self' data: blob: kiosk-media:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self'";
/**
 * Web app / Android app: the core runs in the page, so it talks to the configured server
 * (any address on the local network) and compiles the SQLite WebAssembly module.
 */
const WEB_CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' http: https:; worker-src 'self'";

const csp = (policy: string): Plugin => ({
  name: 'kiosk-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
});

/** Web target: install manifest + a service worker that precaches every emitted file (offline shell). */
const pwa = (): Plugin => ({
  name: 'kiosk-pwa',
  apply: 'build',
  enforce: 'post', // runs after index.html is added to the bundle, so its contents count too
  transformIndexHtml: (html) =>
    html.replace(
      '</head>',
      '    <link rel="manifest" href="./manifest.webmanifest" />\n    <meta name="theme-color" content="#050b18" />\n    <link rel="icon" href="./icons/icon-192.png" />\n    <link rel="apple-touch-icon" href="./icons/icon-192.png" />\n  </head>',
    ),
  generateBundle(_opts, bundle) {
    // Every emitted file plus everything in public-web (manifest, all icons).
    const publicDir = resolve(__dirname, 'src/renderer/public-web');
    const publicFiles = (readdirSync(publicDir, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
      .filter((d) => d.isFile())
      .map((d) => relative(publicDir, join(d.parentPath, d.name)).split('\\').join('/'));
    const emitted = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'sw.js');
    // index.html is cached as the scope URL ('./').
    const files = ['./', ...new Set([...emitted.filter((f) => f !== 'index.html'), ...publicFiles])].sort();
    // The version follows the contents, so any change (index.html, CSP, icons) installs a new worker.
    const hash = createHash('sha256');
    for (const f of emitted) {
      const out = bundle[f];
      hash.update(f).update(out.type === 'chunk' ? out.code : out.source);
    }
    for (const f of publicFiles) hash.update(f).update(readFileSync(join(publicDir, f)));
    const version = hash.digest('hex').slice(0, 12);
    const sw = readFileSync(resolve(__dirname, 'src/renderer/sw-template.js'), 'utf8')
      .replace('__VERSION__', version)
      .replace('__PRECACHE__', JSON.stringify(files, null, 2));
    this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
  },
});

// Renderer (UI) build.
//  - default: Electron (loaded from file://, core in the main process) → dist-renderer
//  - --mode web: web app (PWA) and Android app (Capacitor), core in the page → dist-web
export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  return {
    root: resolve(__dirname, 'src/renderer'),
    base: './',
    publicDir: web ? resolve(__dirname, 'src/renderer/public-web') : false,
    plugins: [react(), csp(web ? WEB_CSP : ELECTRON_CSP), ...(web ? [pwa()] : [])],
    define: {
      __KIOSK_VERSION__: JSON.stringify(pkg.version),
      // Compile-time switch: the Electron build drops the in-page core (and the SQLite WebAssembly) entirely.
      __KIOSK_WEB__: JSON.stringify(web),
    },
    resolve: {
      alias: {
        // Browser-safe entry of the shared package (TS source; never the ./node subpath here).
        '@andishkadeh/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
    build: {
      outDir: resolve(__dirname, web ? 'dist-web' : 'dist-renderer'),
      emptyOutDir: true,
      target: 'chrome110',
      assetsInlineLimit: 0,
    },
    server: { port: 5174, strictPort: true },
  };
});
