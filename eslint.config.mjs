import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: [
          './tsconfig.eslint.json',
          './apps/api/tsconfig.eslint.json',
          './apps/worker/tsconfig.eslint.json',
          './apps/web/tsconfig.eslint.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['apps/*', '@360events/api', '@360events/web', '@360events/worker'],
            message: 'Shared packages must not import from applications.',
          },
          {
            group: ['drizzle-orm', 'postgres'],
            message: 'Database types and ORM internals must not leak into shared public packages.',
          },
        ],
      }],
    },
  },
  // P2-T01: Financial module restrictions
  {
    files: ['apps/api/src/lib/money.ts', 'apps/api/src/**/*.finance.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name=/^(round|floor|ceil)$/]",
          message: 'Math.round, floor, and ceil are forbidden in financial modules. Use explicit bigint arithmetic.',
        },
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'Floating-point parsing is strictly prohibited for financial operations.',
        },
      ],
    },
  },
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**'],
  },
);
