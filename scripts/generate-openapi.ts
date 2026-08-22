/**
 * Writes openapi.json from the Nest application without starting a server.
 *
 * The spec is committed, and CI regenerates it and fails if the result
 * differs. That is what stops the frontend generating its types from a
 * stale document.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';

// Placeholders so env validation passes; nothing here connects to them.
// These must be set before AppModule is loaded, because ConfigModule
// validates at module-evaluation time — hence the dynamic import below
// rather than a top-level one, which would be hoisted above these lines.
process.env.NODE_ENV ??= 'development';
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_SECRET ??= 'openapi-generation-placeholder-secret-value-32';
process.env.QR_SIGNING_SECRET ??= 'openapi-generation-placeholder-qr-secret-32';
process.env.WEB_ORIGIN ??= 'http://localhost:3000';

async function main(): Promise<void> {
  const { AppModule } = await import('../src/app.module');
  const { buildOpenApiDocument } = await import('../src/openapi');

  // No HTTP listener and no lifecycle hooks: Prisma never dials the database.
  // abortOnError:false — the default kills the process silently on an
  // initialisation error, which hides the reason entirely.
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
    preview: true,
    abortOnError: false,
  });

  const document = buildOpenApiDocument(app);

  // __dirname, not import.meta: the project compiles to CommonJS.
  const target = resolve(__dirname, '..', 'openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);

  await app.close();
  process.stdout.write(`OpenAPI spec written to ${target}\n`);
}

main().catch((error: unknown) => {
  // Without this the failure is silent: an unhandled rejection exits
  // non-zero with no message, which is what made this hard to diagnose
  // the first time CI failed.
  process.stderr.write(`Failed to generate the OpenAPI spec:\n${String(error)}\n`);
  if (error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
