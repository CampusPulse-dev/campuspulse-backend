import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

async function main() {
  const base = new URL(process.env.DATABASE_URL ?? '');
  if (
    base.hostname !== '127.0.0.1' ||
    base.port !== '55432' ||
    base.pathname !== '/campuspulse_test'
  )
    throw new Error('Migration rehearsal only supports the isolated Compose test database');
  const name = `campuspulse_upgrade_${randomBytes(6).toString('hex')}`;
  const target = new URL(base);
  target.pathname = `/${name}`;
  const admin = new PrismaClient();
  const directory = mkdtempSync(join(tmpdir(), 'campuspulse-migrations-'));
  const schema = join(directory, 'schema.prisma');
  const run = (args: string[]) => {
    const result = spawnSync(
      process.execPath,
      [resolve('node_modules/prisma/build/index.js'), ...args],
      { stdio: 'inherit', env: { ...process.env, DATABASE_URL: target.toString() } },
    );
    if (result.error || result.status !== 0) throw new Error('Migration rehearsal failed');
  };
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    cpSync('prisma/schema.prisma', schema);
    mkdirSync(join(directory, 'migrations'));
    const migrations = readdirSync('prisma/migrations', { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    cpSync(
      'prisma/migrations/migration_lock.toml',
      join(directory, 'migrations/migration_lock.toml'),
    );
    cpSync(`prisma/migrations/${migrations[0]!}`, join(directory, 'migrations', migrations[0]!), {
      recursive: true,
    });
    run(['migrate', 'deploy', '--schema', schema]);
    for (const migration of migrations.slice(1))
      cpSync(`prisma/migrations/${migration}`, join(directory, 'migrations', migration), {
        recursive: true,
      });
    run(['migrate', 'deploy', '--schema', schema]);
    run([
      'migrate',
      'diff',
      '--from-url',
      target.toString(),
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--exit-code',
    ]);
    process.stdout.write('Initial-schema upgrade rehearsal passed\n');
  } finally {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
}
void main().catch(() => {
  process.stderr.write('Migration upgrade validation failed\n');
  process.exitCode = 1;
});
