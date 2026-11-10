import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../../common/prisma.service';
import type { Env } from '../../config/env';

export interface WebPushPayload {
  title: string;
  body: string;
  href: string;
}

@Injectable()
export class WebPushAdapter {
  private readonly logger = new Logger(WebPushAdapter.name);
  private readonly configured: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    const publicKey = config.get('VAPID_PUBLIC_KEY', { infer: true });
    const privateKey = config.get('VAPID_PRIVATE_KEY', { infer: true });
    const subject = config.get('VAPID_SUBJECT', { infer: true });

    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.configured = true;
    } else {
      this.configured = false;
    }
  }

  async sendToUser(userId: string, payload: WebPushPayload): Promise<number> {
    if (!this.configured) {
      return 0;
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    if (subscriptions.length === 0) {
      return 0;
    }

    const serialized = JSON.stringify(payload);
    let delivered = 0;

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          serialized,
        );
        delivered += 1;
      } catch (error: unknown) {
        const statusCode =
          typeof error === 'object' && error !== null && 'statusCode' in error
            ? Number((error as { statusCode?: unknown }).statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          await this.prisma.pushSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => undefined);
        } else {
          this.logger.warn({
            msg: 'Web Push delivery failed',
            subscriptionId: sub.id,
            statusCode,
          });
        }
      }
    }

    return delivered;
  }
}
