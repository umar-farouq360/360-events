import 'dotenv/config';

const defaultTestDatabaseUrl =
  'postgres://postgres:postgres@localhost:5435/360events_test';

// Vitest loads this config before importing test modules and their DB clients.
process.env.TEST_DATABASE_URL ??= defaultTestDatabaseUrl;

export default {
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
};
