/* ESLint for the whole repository: `npm run lint`.
   The recommended JavaScript and TypeScript rules, the two React hook rules
   that catch real bugs (hooks called conditionally, effects missing a
   dependency), and the right globals for the server, the browser and the
   tests. Type checking itself is `npm run typecheck` (tsc). */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', 'deploy/vercel/public/**', '.data/**', 'windows/**', 'docs/**', '**/*.min.js'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      /* Unused names are mistakes, except a deliberate _placeholder. */
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      /* Kept as a warning: the remaining uses are the shared request-body type
         and providers' JSON (QUALITY_AUDIT.md, technical debt). `npm run lint`
         allows no more than there are today, so the count only goes down. */
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  },
  {
    files: ['backend/**/*.{ts,js}', 'scripts/**/*.mjs', 'tests/**/*.mjs', 'deploy/**/*.mjs', 'frontend/api/**/*.mjs', 'frontend/scripts/**/*.mjs', '*.mjs', '*.js'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    /* GS1 barcodes separate their fields with the control character GS
       (\u001d): matching it is the point of these files. */
    files: ['backend/src/domain/barcodes.ts', 'frontend/src/utils/scanner.ts', 'frontend/src/pages/pos/**/*.tsx'],
    rules: { 'no-control-regex': 'off' }
  },
  {
    /* Plain scripts the page loads before the app (theme, start-up screen). */
    files: ['frontend/public/**/*.js'],
    languageOptions: { globals: { ...globals.browser }, sourceType: 'script' }
  },
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
);
