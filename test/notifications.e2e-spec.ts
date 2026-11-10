import {
  asUser,
  bodyOf,
  createTestApp,
  truncateDatabase,
  type BootstrappedTestApp,
} from './utils/app';
import type {
  AttendeeNotification,
  EventPublic,
  NotificationPreferencesResponse,
  NotificationsResponse,
  PushSubscribeResponse,
  ReadAllNotificationsResponse,
} from '../src/contract';
import { EmailAdapter } from '../src/modules/notifications/email.adapter';
import { NotificationsQueueService } from '../src/modules/notifications/notifications-queue.service';

describe('BullMQ Reminders, Notification Center, Push Subscribe & Cancellation Emails (e2e) [S3-03]', () => {
  let ctx: BootstrappedTestApp;
  let emailAdapter: EmailAdapter;
  let queueService: NotificationsQueueService;

  beforeAll(async () => {
    ctx = await createTestApp();
    emailAdapter = ctx.app.get(EmailAdapter);
    queueService = ctx.app.get(NotificationsQueueService);
  });

  beforeEach(async () => {
    await truncateDatabase(ctx.prisma);
    emailAdapter.clearSentMessages();
    await queueService.drainAllForTests();
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function createPublishedEventWithAfterParty() {
    const owner = await ctx.prisma.user.create({
      data: {
        email: 'sigma.owner@stu.ui.edu.ng',
        studentEmail: 'sigma.owner@stu.ui.edu.ng',
        passwordHash: 'dev-auth-placeholder',
        displayName: 'Sigma Owner',
        role: 'ORGANIZER',
        isVerifiedStudent: true,
      },
    });
    const org = await ctx.prisma.organizer.create({
      data: {
        slug: 'sigma-notify-club',
        name: 'Sigma Notify Club',
        isVerified: true,
        ownerId: owner.id,
        members: { create: [{ userId: owner.id, role: 'OWNER' }] },
      },
    });

    const now = Date.now();
    const startsAt = new Date(now + 30 * 3_600_000);
    const endsAt = new Date(now + 34 * 3_600_000);

    const draftRes = await asUser(ctx.app, owner.email)
      .post('/events')
      .send({
        organizerId: org.id,
        title: 'Havana Reminder Night',
        description: 'Testing 5-stage reminders and cancellation fan-out.',
        category: 'SOCIAL_PARTY',
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        venueName: 'SUB Main Field',
        coverImageUrl: 'https://cdn.campuspulse.ng/covers/havana.webp',
      })
      .expect(201);
    const draft = bodyOf<EventPublic>(draftRes);

    const pubRes = await asUser(ctx.app, owner.email)
      .post(`/events/${draft.id}/publish`)
      .expect(200);
    const mainEvent = bodyOf<EventPublic>(pubRes);

    const apDraftRes = await asUser(ctx.app, owner.email)
      .post('/events')
      .send({
        organizerId: org.id,
        title: 'Havana After-Party',
        description: 'Official after-party.',
        category: 'CLUB_SOCIETY',
        startsAt: endsAt.toISOString(),
        endsAt: new Date(endsAt.getTime() + 3 * 3_600_000).toISOString(),
        venueName: 'Zik SCR',
        coverImageUrl: 'https://cdn.campuspulse.ng/covers/ap.webp',
        parentEventId: mainEvent.id,
        linkType: 'AFTER_PARTY',
      })
      .expect(201);
    const apDraft = bodyOf<EventPublic>(apDraftRes);
    await asUser(ctx.app, owner.email).post(`/events/${apDraft.id}/publish`).expect(200);

    return { owner, mainEvent, startsAt, endsAt };
  }

  it('creates immediate T-0 RSVP notification, schedules deterministic 5-stage reminder jobs, and supports read, read-all, push-subscribe, and preferences', async () => {
    const { mainEvent } = await createPublishedEventWithAfterParty();

    // Attendee RSVPs -> immediate DB-first confirmation notification + delayed BullMQ stage jobs
    await asUser(ctx.app, 'tobi@stu.ui.edu.ng')
      .post('/attendance/rsvps')
      .send({ eventId: mainEvent.id })
      .expect(201);

    const jobIds = await queueService.getScheduledReminderJobIds(mainEvent.id);
    expect(jobIds).toEqual(
      expect.arrayContaining([
        `reminder:${mainEvent.id}:T_24H`,
        `reminder:${mainEvent.id}:T_3H`,
        `reminder:${mainEvent.id}:T_30M`,
        `reminder:${mainEvent.id}:AFTER_PARTY`,
      ]),
    );

    // List notifications -> contains immediate T-0 confirmation with safe app-relative href
    const listRes = await asUser(ctx.app, 'tobi@stu.ui.edu.ng').get('/notifications').expect(200);
    const list = bodyOf<NotificationsResponse>(listRes);
    expect(list.items.length).toBeGreaterThanOrEqual(1);
    const first = list.items[0]!;
    expect(first.title).toContain('Havana Reminder Night');
    expect(first.href.startsWith('/')).toBe(true);
    expect(first.readAt).toBeNull();

    // Mark single notification read
    const readRes = await asUser(ctx.app, 'tobi@stu.ui.edu.ng')
      .post(`/notifications/${first.id}/read`)
      .expect(200);
    const marked = bodyOf<AttendeeNotification>(readRes);
    expect(marked.readAt).not.toBeNull();

    // Create a second notification and mark all read
    const tobi = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'tobi@stu.ui.edu.ng' },
    });
    await ctx.prisma.notification.create({
      data: {
        userId: tobi.id,
        category: 'SOCIAL_FRIEND',
        title: 'Friend accepted',
        body: 'Adaeze is now your friend.',
        linkUrl: '/friends',
      },
    });

    const readAllRes = await asUser(ctx.app, 'tobi@stu.ui.edu.ng')
      .post('/notifications/read-all')
      .expect(200);
    expect(bodyOf<ReadAllNotificationsResponse>(readAllRes)).toEqual({ updatedCount: 1 });

    // Register HTTPS Web Push VAPID subscription
    const subRes = await asUser(ctx.app, 'tobi@stu.ui.edu.ng')
      .post('/notifications/push-subscribe')
      .send({
        endpoint: 'https://fcm.googleapis.com/fcm/send/demo-subscription-1',
        keys: {
          p256dh:
            'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
      })
      .expect(201);
    expect(bodyOf<PushSubscribeResponse>(subRes).endpoint).toContain('https://fcm.googleapis.com');

    // Update notification category mutes
    const prefsRes = await asUser(ctx.app, 'tobi@stu.ui.edu.ng')
      .patch('/notifications/preferences')
      .send({ mutedCategories: ['RECOMMENDATION', 'FOLLOWED_POST'] })
      .expect(200);
    expect(bodyOf<NotificationPreferencesResponse>(prefsRes)).toEqual({
      mutedCategories: ['RECOMMENDATION', 'FOLLOWED_POST'],
    });
  });

  it('reschedules reminders when event time changes, removes pending jobs on cancel, and sends cancellation email to every RSVP via console EmailAdapter', async () => {
    const { owner, mainEvent, startsAt, endsAt } = await createPublishedEventWithAfterParty();

    // Three attendees RSVP
    const emails = ['adaeze@stu.ui.edu.ng', 'kunle@stu.ui.edu.ng', 'fisayo@stu.ui.edu.ng'];
    for (const email of emails) {
      await asUser(ctx.app, email)
        .post('/attendance/rsvps')
        .send({ eventId: mainEvent.id })
        .expect(201);
    }

    // Reschedule event +2 hours -> deterministic reminder jobs stay scheduled with updated delay
    const shiftedStart = new Date(startsAt.getTime() + 2 * 3_600_000);
    const shiftedEnd = new Date(endsAt.getTime() + 2 * 3_600_000);
    await asUser(ctx.app, owner.email)
      .patch(`/events/${mainEvent.id}`)
      .send({
        startsAt: shiftedStart.toISOString(),
        endsAt: shiftedEnd.toISOString(),
      })
      .expect(200);

    const rescheduledIds = await queueService.getScheduledReminderJobIds(mainEvent.id);
    expect(rescheduledIds).toContain(`reminder:${mainEvent.id}:T_24H`);

    emailAdapter.clearSentMessages();

    // Cancel event -> pending reminders removed, EVENT_CRITICAL Notification written, email sent to EVERY RSVP
    const cancelReason = 'Heavy rainstorm warning over SUB Main Field; moving indoors next week.';
    await asUser(ctx.app, owner.email)
      .post(`/events/${mainEvent.id}/cancel`)
      .send({ reason: cancelReason })
      .expect(200);

    await queueService.waitForIdle();

    const afterCancelIds = await queueService.getScheduledReminderJobIds(mainEvent.id);
    expect(afterCancelIds).toEqual([]);

    const sentEmails = emailAdapter.getSentMessages();
    expect(sentEmails).toHaveLength(3);
    expect(sentEmails.map((m) => m.to).sort()).toEqual([...emails].sort());
    for (const msg of sentEmails) {
      expect(msg.subject).toContain('Cancelled');
      expect(msg.text).toContain(cancelReason);
    }

    // Every RSVP also received an in-app EVENT_CRITICAL notification
    for (const email of emails) {
      const notifRes = await asUser(ctx.app, email).get('/notifications').expect(200);
      const items = bodyOf<NotificationsResponse>(notifRes).items;
      expect(items.some((n) => n.body.includes(cancelReason))).toBe(true);
    }
  });
});
