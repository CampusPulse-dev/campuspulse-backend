import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { buildOpenApiDocument } from './openapi';
import { allowsOrigin } from './common/cors-origin';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // Every request reaches us through the hosting proxy. Trust exactly one hop so req.ip
  // (and the auth throttler's fallback key) is the client, not the proxy, while a
  // client-supplied X-Forwarded-For chain still cannot spoof it.
  app.set('trust proxy', 1);

  app.useLogger(app.get(Logger));
  app.use(helmet());

  // Correlates a log line with the requestId returned in ApiError.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers['x-request-id'] as string) ?? randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('x-request-id', id);
    next();
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow: boolean) => void) =>
      callback(null, allowsOrigin(origin)),
    credentials: true,
    // X-Dev-User is only acted on when DEV_AUTH_ENABLED=true (never in production).
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Dev-User', 'X-Request-Id'],
  });

  if (process.env.NODE_ENV !== 'production') {
    SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
  }

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}

void bootstrap();
