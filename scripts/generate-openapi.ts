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
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument } from '../src/openapi';

// Placeholders so env validation passes; nothing here connects to them.
process.env.NODE_ENV ??= 'development';
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_SECRET ??= 'openapi-generation-placeholder-secret-value';
process.env.QR_SIGNING_SECRET ??= 'openapi-generation-placeholder-qr-secret';
process.env.WEB_ORIGIN ??= 'http://localhost:3000';

async function main(): Promise<void> {
  // No HTTP listener and no lifecycle hooks: Prisma never dials the database.
  const app = await NestFactory.create(AppModule, { logger: false, preview: true });
  const document = buildOpenApiDocument(app);

  // __dirname, not import.meta: the project compiles to CommonJS.
  const target = resolve(__dirname, '..', 'openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);

  await app.close();
  process.stdout.write(`OpenAPI spec written to ${target}\n`);
}

void main();
