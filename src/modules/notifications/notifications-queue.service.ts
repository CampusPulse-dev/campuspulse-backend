import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationCategory } from '@prisma/client';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../../common/prisma.service';
import type { Env } from '../../config/env';
import { EmailAdapter, type TransactionalEmailInput } from './email.adapter';
import { NotificationsGuardrailService } from './notifications-guardrails.service';
import { WebPushAdapter } from './web-push.adapter';

export type ReminderStage = 'T_24H' | 'T_3H' | 'T_30M' | 'AFTER_PARTY';

export const ALL_REMINDER_STAGES: readonly ReminderStage[] = [
  'T_24H',
  'T_3H',
  'T_30M',
  'AFTER_PARTY',
];

export interface EventReminderJobData {
  eventId: string;
  stage: ReminderStage;
}

export interface DispatchNotificationJobData {
  notificationId: string;
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  href: string;
  isEventDayStage: boolean;
  email?: TransactionalEmailInput;
  pushOnlyRetry?: boolean;
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

@Injectable()
export class NotificationsQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsQueueService.name);
  private readonly redisUrl: string;

  private capRedis?: IORedis;
  private remindersQueueConn?: IORedis;
  private remindersWorkerConn?: IORedis;
  private dispatchQueueConn?: IORedis;
  private dispatchWorkerConn?: IORedis;

  private remindersQueue?: Queue<EventReminderJobData>;
  private dispatchQueue?: Queue<DispatchNotificationJobData>;
  private remindersWorker?: Worker<EventReminderJobData>;
  private dispatchWorker?: Worker<DispatchNotificationJobData>;
  private closing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly guardrails: NotificationsGuardrailService,
    private readonly webPush: WebPushAdapter,
    private readonly emailAdapter: EmailAdapter,
    config: ConfigService<Env, true>,
  ) {
    this.redisUrl = config.get('REDIS_URL', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    this.closing = false;
    const onRedisError = (err: Error) => {
      if (!this.closing) {
        this.logger.warn({ err: err.message }, 'BullMQ/Redis connection error');
      }
    };
    const connOpts = { maxRetriesPerRequest: null, enableReadyCheck: false };
    this.capRedis = new IORedis(this.redisUrl, connOpts).on('error', onRedisError);
    this.remindersQueueConn = new IORedis(this.redisUrl, connOpts).on('error', onRedisError);
    this.remindersWorkerConn = new IORedis(this.redisUrl, connOpts).on('error', onRedisError);
    this.dispatchQueueConn = new IORedis(this.redisUrl, connOpts).on('error', onRedisError);
    this.dispatchWorkerConn = new IORedis(this.redisUrl, connOpts).on('error', onRedisError);

    this.remindersQueue = new Queue<EventReminderJobData>('event-reminders', {
      connection: this.remindersQueueConn,
    });
    this.remindersQueue.on('error', onRedisError);

    this.dispatchQueue = new Queue<DispatchNotificationJobData>('notifications-dispatch', {
      connection: this.dispatchQueueConn,
    });
    this.dispatchQueue.on('error', onRedisError);

    this.remindersWorker = new Worker<EventReminderJobData>(
      'event-reminders',
      (job) => this.processReminderStage(job),
      { connection: this.remindersWorkerConn },
    );
    this.remindersWorker.on('error', onRedisError);

    this.dispatchWorker = new Worker<DispatchNotificationJobData>(
      'notifications-dispatch',
      (job) => this.processDispatch(job),
      { connection: this.dispatchWorkerConn },
    );
    this.dispatchWorker.on('error', onRedisError);

    await Promise.all([
      this.remindersQueue.waitUntilReady(),
      this.dispatchQueue.waitUntilReady(),
      this.remindersWorker.waitUntilReady(),
      this.dispatchWorker.waitUntilReady(),
    ]);
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    await Promise.allSettled([
      this.remindersWorker?.close(true),
      this.dispatchWorker?.close(true),
      this.remindersQueue?.close(),
      this.dispatchQueue?.close(),
    ]);
    await Promise.allSettled([
      this.capRedis?.quit(),
      this.remindersQueueConn?.quit(),
      this.remindersWorkerConn?.quit(),
      this.dispatchQueueConn?.quit(),
      this.dispatchWorkerConn?.quit(),
    ]);
  }

  buildReminderJobId(eventId: string, stage: ReminderStage): string {
    return `reminder:${eventId}:${stage}`;
  }

  async enqueueDispatch(data: DispatchNotificationJobData, delayMs = 0): Promise<void> {
    if (!this.dispatchQueue) return;
    await this.dispatchQueue.add('dispatch', data, {
      ...(delayMs > 0 ? { delay: delayMs } : {}),
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  }

  async scheduleEventReminders(params: {
    eventId: string;
    startsAt: Date;
    endsAt: Date;
    hasLinkedAfterParty: boolean;
    stages?: readonly ReminderStage[];
    reschedule?: boolean;
  }): Promise<void> {
    if (!this.remindersQueue) return;

    const nowMs = Date.now();
    const stages = params.stages ?? ALL_REMINDER_STAGES;

    const targetTimeByStage: Record<ReminderStage, number | null> = {
      T_24H: params.startsAt.getTime() - 24 * HOUR_MS,
      T_3H: params.startsAt.getTime() - 3 * HOUR_MS,
      T_30M: params.startsAt.getTime() - 30 * MINUTE_MS,
      AFTER_PARTY: params.hasLinkedAfterParty ? params.endsAt.getTime() - 15 * MINUTE_MS : null,
    };

    for (const stage of stages) {
      const jobId = this.buildReminderJobId(params.eventId, stage);
      if (params.reschedule) {
        const existing = await this.remindersQueue.getJob(jobId);
        if (existing) {
          await existing.remove().catch(() => undefined);
        }
      }

      const targetMs = targetTimeByStage[stage];
      if (targetMs === null) {
        continue;
      }

      const delayMs = targetMs - nowMs;
      if (delayMs <= 0) {
        continue;
      }

      await this.remindersQueue.add(
        stage,
        { eventId: params.eventId, stage },
        {
          jobId,
          delay: delayMs,
          removeOnComplete: true,
          removeOnFail: 50,
        },
      );
    }
  }

  async removeEventReminders(eventId: string): Promise<void> {
    if (!this.remindersQueue) return;

    for (const stage of ALL_REMINDER_STAGES) {
      const jobId = this.buildReminderJobId(eventId, stage);
      const existing = await this.remindersQueue.getJob(jobId);
      if (existing) {
        await existing.remove().catch(() => undefined);
      }
    }
  }

  async getScheduledReminderJobIds(eventId: string): Promise<string[]> {
    if (!this.remindersQueue) return [];

    const found: string[] = [];
    for (const stage of ALL_REMINDER_STAGES) {
      const jobId = this.buildReminderJobId(eventId, stage);
      const job = await this.remindersQueue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'delayed' || state === 'waiting' || state === 'prioritized') {
          found.push(jobId);
        }
      }
    }
    return found;
  }

  async waitForIdle(timeoutMs = 5_000): Promise<void> {
    if (!this.dispatchQueue) return;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const counts = await this.dispatchQueue.getJobCounts('waiting', 'active');
      if ((counts.waiting ?? 0) === 0 && (counts.active ?? 0) === 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }

  async drainAllForTests(): Promise<void> {
    await Promise.all([
      this.remindersQueue?.obliterate({ force: true }).catch(() => undefined),
      this.dispatchQueue?.obliterate({ force: true }).catch(() => undefined),
    ]);
  }

  private async processDispatch(job: Job<DispatchNotificationJobData>): Promise<void> {
    const data = job.data;

    if (data.email && !data.pushOnlyRetry) {
      await this.emailAdapter.send(data.email);
    }

    if (!this.capRedis) return;

    const decision = await this.guardrails.evaluatePushDelivery(this.capRedis, {
      userId: data.userId,
      category: data.category,
      isEventDayStage: data.isEventDayStage,
    });

    if (decision.deferMs > 0) {
      await this.enqueueDispatch(
        {
          ...data,
          pushOnlyRetry: true,
        },
        decision.deferMs,
      );
      return;
    }

    if (decision.allowPush) {
      await this.webPush.sendToUser(data.userId, {
        title: data.title,
        body: data.body,
        href: data.href,
      });
    }
  }

  private async processReminderStage(job: Job<EventReminderJobData>): Promise<void> {
    const { eventId, stage } = job.data;

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        childEvents: {
          where: {
            linkType: 'AFTER_PARTY',
            parentLinkApproved: true,
            status: 'PUBLISHED',
          },
          orderBy: { startsAt: 'asc' },
          take: 1,
        },
      },
    });

    if (!event || event.status !== 'PUBLISHED') {
      return;
    }

    if (stage === 'T_24H') {
      const rsvps = await this.prisma.rsvp.findMany({
        where: { eventId, status: 'CONFIRMED' },
        select: { userId: true },
      });
      for (const rsvp of rsvps) {
        await this.createAndDispatch({
          userId: rsvp.userId,
          category: 'REMINDER',
          title: `Tomorrow: ${event.title}`,
          body: `${event.venueName}${event.dressCode ? ` · Dress code: ${event.dressCode}` : ''}`,
          href: `/e/${event.slug}`,
          isEventDayStage: false,
        });
      }
      return;
    }

    if (stage === 'T_3H') {
      const [rsvps, interests] = await Promise.all([
        this.prisma.rsvp.findMany({
          where: { eventId, status: 'CONFIRMED' },
          select: { userId: true },
        }),
        this.prisma.eventInterest.findMany({
          where: { eventId },
          select: { userId: true },
        }),
      ]);

      const rsvpUserIds = new Set(rsvps.map((r) => r.userId));
      for (const rsvp of rsvps) {
        await this.createAndDispatch({
          userId: rsvp.userId,
          category: 'REMINDER',
          title: `Starts in 3 hours: ${event.title}`,
          body: `Heading to ${event.venueName}? Your QR pass is ready in your wallet.`,
          href: '/tickets',
          isEventDayStage: true,
        });
      }

      for (const interest of interests) {
        if (rsvpUserIds.has(interest.userId)) continue;
        await this.createAndDispatch({
          userId: interest.userId,
          category: 'REMINDER',
          title: `Starts in 3 hours: ${event.title}`,
          body: 'Starts in 3 hours — lock in your free QR pass before doors fill up.',
          href: `/e/${event.slug}`,
          isEventDayStage: true,
        });
      }
      return;
    }

    if (stage === 'T_30M') {
      const rsvps = await this.prisma.rsvp.findMany({
        where: { eventId, status: 'CONFIRMED' },
        select: { userId: true },
      });
      for (const rsvp of rsvps) {
        await this.createAndDispatch({
          userId: rsvp.userId,
          category: 'REMINDER',
          title: `Doors opening: ${event.title}`,
          body: 'Open your offline QR ticket now for fast entry at the gate.',
          href: '/tickets',
          isEventDayStage: true,
        });
      }
      return;
    }

    if (stage === 'AFTER_PARTY') {
      const afterParty = event.childEvents[0];
      if (!afterParty) return;

      const rsvps = await this.prisma.rsvp.findMany({
        where: { eventId, status: 'CONFIRMED' },
        select: { userId: true },
      });
      for (const rsvp of rsvps) {
        await this.createAndDispatch({
          userId: rsvp.userId,
          category: 'REMINDER',
          title: `Keep your night going: ${afterParty.title}`,
          body: `Next up at ${afterParty.venueName}. Tap to view the official after-party.`,
          href: `/e/${afterParty.slug}`,
          isEventDayStage: true,
        });
      }
    }
  }

  async createAndDispatch(params: {
    userId: string;
    category: NotificationCategory;
    title: string;
    body: string;
    href: string;
    isEventDayStage: boolean;
    email?: TransactionalEmailInput;
  }): Promise<void> {
    try {
      const safeHref =
        params.href.startsWith('/') && !params.href.startsWith('//') ? params.href : '/';
      // DB-first guarantee: always write to Notification table before push/email fan-out
      const created = await this.prisma.notification.create({
        data: {
          userId: params.userId,
          category: params.category,
          title: params.title,
          body: params.body,
          linkUrl: safeHref,
        },
      });

      await this.enqueueDispatch({
        notificationId: created.id,
        userId: params.userId,
        category: params.category,
        title: params.title,
        body: params.body,
        href: safeHref,
        isEventDayStage: params.isEventDayStage,
        ...(params.email ? { email: params.email } : {}),
      });
    } catch (error: unknown) {
      this.logger.error({
        msg: 'Failed to create or enqueue notification',
        userId: params.userId,
        category: params.category,
        err: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
