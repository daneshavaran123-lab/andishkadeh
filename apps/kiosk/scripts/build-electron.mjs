// Bundles the Electron main + preload scripts (core and shared code included) with esbuild.
// Only native / Electron modules stay external.
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  external: ['electron', 'better-sqlite3'],
  alias: {
    '@andishkadeh/shared/node': resolve(root, '../../packages/shared/src/node.ts'),
    '@andishkadeh/shared': resolve(root, '../../packages/shared/src/index.ts'),
  },
};

await build({ ...common, entryPoints: [resolve(root, 'electron/main.ts')], outfile: resolve(root, 'dist-electron/main.js') });
await build({ ...common, entryPoints: [resolve(root, 'electron/preload.ts')], outfile: resolve(root, 'dist-electron/preload.js') });
await build({ ...common, entryPoints: [resolve(root, 'electron/admin-preload.ts')], outfile: resolve(root, 'dist-electron/admin-preload.js') });
