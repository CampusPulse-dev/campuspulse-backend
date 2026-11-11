import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env';
import { PrismaModule } from './common/prisma.module';
import { EventsModule } from './modules/events/events.module';
import { IdentityModule } from './modules/identity/identity.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';
import { VerificationModule } from './modules/verification/verification.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        // Student emails are NDPA personal data — never log a request body or dev-auth header.
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-dev-user"]',
          'req.body',
        ],
      },
    }),
    EventEmitterModule.forRoot(),
    // Baseline limit. RSVP bursts run ~200/min across all users, so this
    // is a per-IP abuse guard, not a capacity control.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    HealthModule,
    EventsModule,
    IdentityModule,
    AttendanceModule,
    NotificationsModule,
    VerificationModule,
    AdminModule,
  ],
})
export class AppModule {}
