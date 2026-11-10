import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { EmailAdapter } from './email.adapter';
import { NotificationsGuardrailService } from './notifications-guardrails.service';
import { NotificationsQueueService } from './notifications-queue.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { WebPushAdapter } from './web-push.adapter';

@Module({
  imports: [IdentityModule],
  controllers: [NotificationsController],
  providers: [
    EmailAdapter,
    WebPushAdapter,
    NotificationsGuardrailService,
    NotificationsQueueService,
    NotificationsService,
  ],
  exports: [EmailAdapter, WebPushAdapter, NotificationsQueueService, NotificationsService],
})
export class NotificationsModule {}
