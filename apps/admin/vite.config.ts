import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The panel is served under /admin (PRD A-01 routes: /admin/login, /admin/dashboard, ...).
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  resolve: {
    alias: { '@andishkadeh/shared': resolve(__dirname, '../../packages/shared/src/index.ts') },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { port: 5173, strictPort: true },
});
