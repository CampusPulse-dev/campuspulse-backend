import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../../src/common/prisma.service';
import { validateEnv, type Env } from '../../src/config/env';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??=
  'postgresql://campuspulse:campuspulse@localhost:5432/campuspulse_test?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-at-least-32-characters-long';
process.env.QR_SIGNING_SECRET ??= 'test-qr-secret-value-at-least-32-characters-long';
process.env.WEB_ORIGIN ??= 'http://localhost:3000';
process.env.LOG_LEVEL ??= 'error';
process.env.DEV_AUTH_ENABLED ??= 'true';

import { AppModule } from '../../src/app.module';

export interface TestAppOptions {
  devAuthEnabled?: boolean;
  envOverrides?: Record<string, string>;
}

export interface BootstrappedTestApp {
  app: INestApplication;
  prisma: PrismaService;
  close: () => Promise<void>;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<BootstrappedTestApp> {
  let builder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (options.devAuthEnabled !== undefined || options.envOverrides) {
    const customEnv = validateEnv({
      ...process.env,
      ...(options.devAuthEnabled !== undefined
        ? { DEV_AUTH_ENABLED: options.devAuthEnabled ? 'true' : 'false' }
        : {}),
      ...options.envOverrides,
    });
    builder = builder.overrideProvider(ConfigService).useValue({
      get: <K extends keyof Env>(key: K) => customEnv[key],
    });
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('x-request-id', id);
    next();
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.init();

  const prisma = app.get(PrismaService);

  return {
    app,
    prisma,
    close: async () => {
      await app.close();
    },
  };
}

export async function truncateDatabase(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  `;

  if (rows.length === 0) return;

  const quoted = rows.map((r) => `"public"."${r.tablename.replace(/"/g, '""')}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`);
}

export function bodyOf<T>(res: { body: unknown }): T {
  return res.body as T;
}

function withPrefix(path: string): string {
  if (path.startsWith('/api/v1')) return path;
  return `/api/v1${path.startsWith('/') ? path : `/${path}`}`;
}

export function anon(app: INestApplication) {
  const server = app.getHttpServer() as App;
  return {
    get: (path: string) => request(server).get(withPrefix(path)),
    post: (path: string) => request(server).post(withPrefix(path)),
    patch: (path: string) => request(server).patch(withPrefix(path)),
    put: (path: string) => request(server).put(withPrefix(path)),
    delete: (path: string) => request(server).delete(withPrefix(path)),
  };
}

// TODO(S1-02): replace with JWT helper once real auth lands.
export function asUser(app: INestApplication, email: string) {
  const server = app.getHttpServer() as App;
  return {
    get: (path: string) => request(server).get(withPrefix(path)).set('X-Dev-User', email),
    post: (path: string) => request(server).post(withPrefix(path)).set('X-Dev-User', email),
    patch: (path: string) => request(server).patch(withPrefix(path)).set('X-Dev-User', email),
    put: (path: string) => request(server).put(withPrefix(path)).set('X-Dev-User', email),
    delete: (path: string) => request(server).delete(withPrefix(path)).set('X-Dev-User', email),
  };
}
