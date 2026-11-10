import { Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DOMAIN_EVENTS,
  type EventCancelledPayload,
  type EventUpdatedPayload,
  type InterestLifecyclePayload,
  type RsvpLifecyclePayload,
} from '../../common/domain-events';
import { PrismaService } from '../../common/prisma.service';
import type {
  AttendeeNotification,
  NotificationPreferencesResponse,
  NotificationsResponse,
  PushSubscribeResponse,
  PushSubscriptionBody,
  ReadAllNotificationsResponse,
  UpdateNotificationPreferencesBody,
} from '../../contract';
import { NotificationsQueueService } from './notifications-queue.service';

function toAttendeeNotification(row: {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  createdAt: Date;
  readAt: Date | null;
}): AttendeeNotification {
  const rawHref = row.linkUrl ?? '/';
  const href = rawHref.startsWith('/') && !rawHref.startsWith('//') ? rawHref : '/';
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    href,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: NotificationsQueueService,
  ) {}

  @OnEvent(DOMAIN_EVENTS.RSVP_CREATED)
  async handleRsvpCreated(payload: RsvpLifecyclePayload): Promise<void> {
    if (payload.status === 'CANCELLED') return;

    const event = await this.prisma.event.findUnique({
      where: { id: payload.eventId },
      include: {
        childEvents: {
          where: {
            linkType: 'AFTER_PARTY',
            parentLinkApproved: true,
            status: 'PUBLISHED',
          },
          take: 1,
        },
      },
    });
    if (!event) return;

    if (payload.status === 'CONFIRMED') {
      await this.queue.createAndDispatch({
        userId: payload.userId,
        category: 'REMINDER',
        title: `RSVP confirmed: ${event.title}`,
        body: `Your offline QR pass for ${event.venueName} is ready in your ticket wallet.`,
        href: '/tickets',
        isEventDayStage: true,
      });
    } else {
      await this.queue.createAndDispatch({
        userId: payload.userId,
        category: 'REMINDER',
        title: `Waitlist spot saved: ${event.title}`,
        body: 'We will promote you automatically if a spot opens up.',
        href: '/tickets',
        isEventDayStage: false,
      });
    }

    await this.queue.scheduleEventReminders({
      eventId: event.id,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      hasLinkedAfterParty: event.childEvents.length > 0,
    });
  }

  @OnEvent(DOMAIN_EVENTS.RSVP_PROMOTED)
  async handleRsvpPromoted(payload: RsvpLifecyclePayload): Promise<void> {
    const event = await this.prisma.event.findUnique({
      where: { id: payload.eventId },
      select: { id: true, title: true, venueName: true },
    });
    if (!event) return;

    await this.queue.createAndDispatch({
      userId: payload.userId,
      category: 'EVENT_CRITICAL',
      title: `You're in! Spot confirmed for ${event.title}`,
      body: `You moved off the waitlist for ${event.venueName}. Open your QR pass now.`,
      href: '/tickets',
      isEventDayStage: true,
    });
  }

  @OnEvent(DOMAIN_EVENTS.INTEREST_ADDED)
  async handleInterestAdded(payload: InterestLifecyclePayload): Promise<void> {
    const event = await this.prisma.event.findUnique({
      where: { id: payload.eventId },
      select: { id: true, status: true, startsAt: true, endsAt: true },
    });
    if (!event || event.status !== 'PUBLISHED') return;

    await this.queue.scheduleEventReminders({
      eventId: event.id,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      hasLinkedAfterParty: false,
      stages: ['T_3H'],
    });
  }

  @OnEvent(DOMAIN_EVENTS.EVENT_UPDATED)
  async handleEventUpdated(payload: EventUpdatedPayload): Promise<void> {
    const event = await this.prisma.event.findUnique({
      where: { id: payload.eventId },
      include: {
        childEvents: {
          where: {
            linkType: 'AFTER_PARTY',
            parentLinkApproved: true,
            status: 'PUBLISHED',
          },
          take: 1,
        },
      },
    });
    if (!event || event.status !== 'PUBLISHED') return;

    await this.queue.scheduleEventReminders({
      eventId: event.id,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      hasLinkedAfterParty: event.childEvents.length > 0,
      reschedule: true,
    });

    if (payload.previousStartsAt !== payload.startsAt) {
      const rsvps = await this.prisma.rsvp.findMany({
        where: {
          eventId: event.id,
          status: { in: ['CONFIRMED', 'WAITLISTED'] },
        },
        include: {
          user: { select: { id: true, email: true } },
        },
      });

      for (const rsvp of rsvps) {
        const subject = `Schedule Updated: ${payload.title}`;
        const body = `${payload.title} at ${payload.venueName} has a new start time.`;
        await this.queue.createAndDispatch({
          userId: rsvp.user.id,
          category: 'EVENT_CRITICAL',
          title: subject,
          body,
          href: `/e/${payload.slug}`,
          isEventDayStage: true,
          email: {
            userId: rsvp.user.id,
            to: rsvp.user.email,
            subject,
            text: `${body}\nNew start time: ${payload.startsAt}`,
            eventId: event.id,
            template: 'event-updated',
          },
        });
      }
    }
  }

  @OnEvent(DOMAIN_EVENTS.EVENT_CANCELLED)
  async handleEventCancelled(payload: EventCancelledPayload): Promise<void> {
    await this.queue.removeEventReminders(payload.eventId);

    const rsvps = await this.prisma.rsvp.findMany({
      where: {
        eventId: payload.eventId,
        status: { in: ['CONFIRMED', 'WAITLISTED'] },
      },
      include: {
        user: {
          select: { id: true, email: true },
        },
      },
    });

    for (const rsvp of rsvps) {
      const subject = `Event Cancelled: ${payload.title}`;
      const body = `${payload.title} has been cancelled. Reason: ${payload.reason}`;
      await this.queue.createAndDispatch({
        userId: rsvp.user.id,
        category: 'EVENT_CRITICAL',
        title: subject,
        body,
        href: `/e/${payload.slug}`,
        isEventDayStage: true,
        email: {
          userId: rsvp.user.id,
          to: rsvp.user.email,
          subject,
          text: body,
          eventId: payload.eventId,
          template: 'event-cancelled',
        },
      });
    }
  }

  async listNotifications(userId: string): Promise<NotificationsResponse> {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });

    return {
      items: rows.map(toAttendeeNotification),
    };
  }

  async markRead(userId: string, notificationId: string): Promise<AttendeeNotification> {
    const existing = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }

    const updated = existing.readAt
      ? existing
      : await this.prisma.notification.update({
          where: { id: existing.id },
          data: { readAt: new Date() },
        });

    return toAttendeeNotification(updated);
  }

  async markAllRead(userId: string): Promise<ReadAllNotificationsResponse> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return { updatedCount: res.count };
  }

  async subscribePush(userId: string, body: PushSubscriptionBody): Promise<PushSubscribeResponse> {
    const saved = await this.prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
      update: {
        userId,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });

    return {
      id: saved.id,
      endpoint: saved.endpoint,
      createdAt: saved.createdAt.toISOString(),
    };
  }

  async updatePreferences(
    userId: string,
    body: UpdateNotificationPreferencesBody,
  ): Promise<NotificationPreferencesResponse> {
    const uniqueMuted = [...new Set(body.mutedCategories)];

    const saved = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        mutedCategories: uniqueMuted,
      },
      update: {
        mutedCategories: uniqueMuted,
      },
    });

    return {
      mutedCategories: saved.mutedCategories,
    };
  }
}
