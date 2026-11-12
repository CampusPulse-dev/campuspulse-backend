import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { spawnSync } from 'node:child_process';
function output(command: string, args: string[], optional = false): string | null {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    if (optional) return null;
    throw new Error(`Runtime evidence collection failed: ${command}`);
  }
  return result.stdout.trim();
}
const evidence = {
  recordedAt: new Date().toISOString(),
  backendCommit: output('git', ['rev-parse', 'HEAD']),
  frontendCommit: process.env.FRONTEND_SHA ?? null,
  node: process.version,
  k6: output('k6', ['version'], true),
  machine: {
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    memoryBytes: totalmem(),
  },
  runtimeFlags: {
    NODE_ENV: 'test',
    PORT: 3001,
    DEV_AUTH_ENABLED: false,
    EMAIL_TRANSPORT: 'memory',
    WEB_ORIGIN: 'http://localhost:3104',
  },
  serviceImageIds: Object.fromEntries(
    ['postgres', 'redis', 'minio'].map((service) => [
      service,
      output('docker', ['inspect', `campuspulse-s6-test-${service}-1`, '--format', '{{.Image}}']),
    ]),
  ),
  minioSourceCommit: readFileSync('docker/minio.test.Dockerfile', 'utf8').match(
    /[a-f0-9]{40}/,
  )?.[0],
  cacheReset:
    'Fresh CI runner and isolated Compose project. Load accounts created before measurement. Lighthouse starts fresh Chrome and resets storage for each cold sample.',
};
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/runtime-evidence.json', JSON.stringify(evidence, null, 2));
process.stdout.write('Recorded runtime evidence without credentials\n');
