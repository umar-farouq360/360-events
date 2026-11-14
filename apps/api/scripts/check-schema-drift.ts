import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationRoot = resolve(apiRoot, 'src/db/migrations');
const temporaryRoot = await mkdtemp(join(tmpdir(), '360events-schema-drift-'));
const temporaryConfig = resolve(apiRoot, '.drizzle-drift-check.config.ts');

function runDrizzle(args: string[]): boolean {
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(
    executable,
    ['exec', 'drizzle-kit', ...args],
    { cwd: apiRoot, env: process.env, stdio: 'inherit' },
  );

  if (result.error) {
    console.error('[SCHEMA DRIFT] Could not start Drizzle Kit:', result.error.message);
    return false;
  }

  return result.status === 0;
}

try {
  // Seed the temporary output with committed snapshots so Drizzle compares
  // the current TypeScript schema against the latest committed schema state.
  await cp(join(migrationRoot, 'meta'), join(temporaryRoot, 'meta'), { recursive: true });

  const config = {
    schema: resolve(apiRoot, 'src/db/schema/index.ts'),
    out: temporaryRoot,
    dialect: 'postgresql',
    strict: true,
    verbose: true,
  };

  await writeFile(
    temporaryConfig,
    'export default ' + JSON.stringify(config, null, 2) + ';\\n',
    'utf8',
  );

  if (!runDrizzle(['check', '--config', temporaryConfig])) {
    throw new Error('Committed Drizzle migration history failed drizzle-kit check.');
  }

  if (!runDrizzle([
    'generate',
    '--config',
    temporaryConfig,
    '--name',
    'schema_drift_check',
  ])) {
    throw new Error('Drizzle could not compare the schema with the committed snapshot.');
  }

  const generatedSql = (await readdir(temporaryRoot)).filter((file) => file.endsWith('.sql'));

  if (generatedSql.length > 0) {
    console.error(
      '\\n[SCHEMA DRIFT] The TypeScript schema contains changes missing from committed migrations.',
    );
    console.error('Generated preview migration(s):');
    for (const file of generatedSql) {
      console.error('  - ' + file);
    }
    console.error(
      'Review the change, create a real migration with pnpm --filter @360events/api db:generate, and commit it.',
    );
    process.exitCode = 1;
  } else {
    console.log('[SCHEMA DRIFT] Schema matches the latest committed migration snapshot.');
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
  await rm(temporaryConfig, { force: true });
}
