import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.mjs',
            'vitest.workspace.ts',
            'apps/api/tests/*.ts',
            'apps/api/tests/helpers/*.ts',
            'apps/api/drizzle.config.ts',
            'apps/api/vitest.config.ts',
            'apps/worker/tests/*.ts',
            'apps/worker/vitest.config.ts',
            'apps/web/postcss.config.js',
            'apps/web/tailwind.config.js',
          ],
          defaultProject: 'tsconfig.eslint.json',
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error'
    }
  },
  {
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['apps/*', '@360events/api', '@360events/web', '@360events/worker'],
            message: 'Shared packages must not import from applications.'
          },
          {
            group: ['drizzle-orm', 'postgres'],
            message: 'Database types and ORM internals must not leak into shared public packages.'
          }
        ]
      }]
    }
  },
  // P2-T01: Financial module restrictions
  {
    files: ['apps/api/src/lib/money.ts', 'apps/api/src/**/*.finance.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name=/^(round|floor|ceil)$/]",
          message: 'Math.round, floor, and ceil are forbidden in financial modules. Use explicit bigint arithmetic.'
        },
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'Floating-point parsing is strictly prohibited for financial operations.'
        }
      ]
    }
  },
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**']
  }
);
