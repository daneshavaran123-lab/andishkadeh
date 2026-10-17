// Lint (pnpm lint): bug patterns the type checker does not see. Type checking stays in `pnpm typecheck`.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/dist-*/',
    'apps/kiosk/android/',
    'apps/kiosk/release/',
    'apps/kiosk/.kiosk-data/',
    'apps/server/storage/',
    'e2e/test-results/',
    'e2e/playwright-report/',
    'docs/',
    'tools/uml/.cache/',
    '.gstack/',
  ]),

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    // A disable comment that no longer silences anything fails the lint, so stale ones get removed.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // `_name` marks a deliberately unused binding (placeholder argument, ignored destructured field).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
  },
  // Promises (type-aware): an unawaited, unhandled promise loses its error. Event handlers wrap async
  // functions with `action(fn)` in the admin panel, or use `() => void fn()` where fn handles its own errors.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/*.config.ts'], // tool configs are not part of a tsconfig project
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  // Tests read untyped JSON bodies and use the Prisma client generated in another package.
  {
    files: ['apps/*/test/**', '**/*.test.ts', 'e2e/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  // The rule does not see a schema used only in a parameter decorator of a class's last method
  // (`@Body(new ZodPipe(Schema))`) and reports it as unused.
  {
    files: ['apps/server/src/**/*.controller.ts'],
    rules: { 'no-useless-assignment': 'off' },
  },

  // Browser: admin panel, kiosk UI and the web/Android host of the kiosk core.
  {
    files: ['apps/admin/src/**', 'apps/kiosk/src/renderer/**', 'apps/kiosk/src/platform/web/**'],
    languageOptions: { globals: globals.browser },
  },
  // React components: hooks must be called unconditionally; effect dependencies are checked.
  {
    files: ['apps/admin/src/**/*.tsx', 'apps/kiosk/src/renderer/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Node: server, Electron shell, Node host and dev bridge of the kiosk, build and release scripts, tests, tool configs.
  {
    files: [
      'apps/server/**',
      'apps/kiosk/electron/**',
      'apps/kiosk/src/platform/node/**',
      'apps/kiosk/src/dev-bridge/**',
      'apps/kiosk/scripts/**',
      'apps/kiosk/test/**',
      'packages/shared/src/node.ts',
      'e2e/**',
      'tools/**',
      '**/*.config.{ts,mjs,js}',
    ],
    languageOptions: { globals: globals.node },
  },
  // Service worker template: the build replaces the two placeholders with the version and file list.
  {
    files: ['apps/kiosk/src/renderer/sw-template.js'],
    languageOptions: { globals: { ...globals.serviceworker, __PRECACHE__: 'readonly' } },
  },
]);
