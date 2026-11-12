import { spawnSync } from 'node:child_process';
import { prepareTestBuckets } from './test-buckets';

// Deliberately separate from .env, development volumes and shared staging databases.
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL:
    'postgresql://campuspulse:campuspulse-test-only@127.0.0.1:55432/campuspulse_test?schema=public',
  REDIS_URL: 'redis://127.0.0.1:56379',
  JWT_SECRET: 'isolated-test-jwt-secret-value-at-least-32-characters',
  QR_SIGNING_SECRET: 'isolated-test-qr-secret-value-at-least-32-characters',
  QR_SIGNING_PRIVATE_KEY: undefined,
  WEB_ORIGIN: 'http://localhost:3104',
  LOG_LEVEL: 'error',
  DEV_AUTH_ENABLED: 'true',
  EMAIL_TRANSPORT: 'memory',
  RESEND_API_KEY: undefined,
  EMAIL_FROM: undefined,
  VAPID_PUBLIC_KEY: undefined,
  VAPID_PRIVATE_KEY: undefined,
  S3_ENDPOINT: 'http://127.0.0.1:59000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'campuspulse-test-media',
  S3_PRIVATE_BUCKET: 'campuspulse-test-private',
  S3_ACCESS_KEY_ID: 'campuspulse-test',
  S3_SECRET_ACCESS_KEY: 'campuspulse-test-only',
  S3_PUBLIC_BASE_URL: 'http://127.0.0.1:59000/campuspulse-test-media',
  S3_FORCE_PATH_STYLE: 'true',
};
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const action = process.argv[2] ?? 'test';
if (action === 'up') {
  run('docker', [
    'compose',
    '-f',
    'compose.test.yml',
    'up',
    '-d',
    '--wait',
    'postgres',
    'redis',
    'minio',
  ]);
  void prepareTestBuckets().catch(() => {
    process.stderr.write('Test bucket setup failed\n');
    process.exitCode = 1;
  });
} else if (action === 'migrate') {
  run('npx', ['prisma', 'migrate', 'deploy']);
  run('npx', ['prisma', 'migrate', 'status']);
} else if (action === 'test') {
  run('node', [
    '--max-old-space-size=4096',
    './node_modules/jest/bin/jest.js',
    '--config',
    'test/jest-e2e.json',
    '--runInBand',
    ...process.argv.slice(3),
  ]);
} else if (action === 'seed') {
  run('npx', ['tsx', 'prisma/seed.ts']);
} else if (action === 'load-fixtures') {
  run('npx', ['tsx', 'scripts/prepare-load.ts']);
} else if (action === 'serve-live') {
  env.DEV_AUTH_ENABLED = 'false';
  run('node', ['dist/main.js']);
} else if (action === 'migration-check') {
  run('npx', ['tsx', 'scripts/check-migrations.ts']);
} else if (action === 'browser-fixtures') {
  // Nest injection needs TypeScript's decorator metadata; esbuild/tsx omits it.
  run('npx', ['tsc', '--project', 'tsconfig.fixtures.json']);
  run('node', ['.test-dist/scripts/browser-fixtures.js']);
} else {
  throw new Error('Expected up, migrate, test or seed');
}
