import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Content-Security-Policy of the production panel (meta tag, so it also applies when the panel is
 * hosted apart from the API). Dev mode keeps Vite's inline HMR preamble working. The API origin
 * (VITE_API_URL, empty = same origin) is allowed for API calls. Images may come from any http(s)
 * origin: media URLs are absolute (server PUBLIC_BASE_URL), which can differ from the address the
 * panel was opened with; scripts stay limited to the panel itself.
 */
const csp = (apiUrl: string): Plugin => {
  const api = apiUrl ? ` ${new URL(apiUrl).origin}` : '';
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: http: https:",
    "font-src 'self' data:",
    `connect-src 'self'${api}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'admin-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
};

// The panel is served under /admin (PRD A-01 routes: /admin/login, /admin/dashboard, ...).
export default defineConfig(({ mode }) => ({
  base: '/admin/',
  plugins: [react(), csp(process.env.VITE_API_URL ?? loadEnv(mode, __dirname, 'VITE_').VITE_API_URL ?? '')],
  resolve: {
    alias: { '@andishkadeh/shared': resolve(__dirname, '../../packages/shared/src/index.ts') },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { port: 5173, strictPort: true },
}));
