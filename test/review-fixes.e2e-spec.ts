import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  CancelRsvpResponse,
  CheckInBatchResponse,
  CreateRsvpResponse,
  FeedResponse,
  FriendsResponse,
  NotificationsResponse,
} from '../src/contract';
import { EmailAdapter } from '../src/modules/notifications/email.adapter';
import { NotificationsQueueService } from '../src/modules/notifications/notifications-queue.service';
import {
  anon,
  asUser,
  bodyOf,
  createTestApp,
  truncateDatabase,
  type BootstrappedTestApp,
} from './utils/app';

const OWNER = 'review.owner@stu.ui.edu.ng';
const HOUR = 3_600_000;

describe('Code-review regressions across events, attendance, friends and notifications (e2e)', () => {
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

  async function createOrganizer() {
    const owner = await ctx.prisma.user.create({
      data: {
        email: OWNER,
        passwordHash: 'dev-auth-placeholder',
        displayName: 'Review Owner',
        role: 'ORGANIZER',
      },
    });
    return ctx.prisma.organizer.create({
      data: {
        slug: 'review-club',
        name: 'Review Club',
        isVerified: true,
        ownerId: owner.id,
        members: { create: [{ userId: owner.id, role: 'OWNER' }] },
      },
    });
  }

  async function createEvent(
    organizerId: string,
    overrides: {
      slug?: string;
      capacity?: number | null;
      startsAt?: Date;
      endsAt?: Date;
    } = {},
  ) {
    const now = Date.now();
    return ctx.prisma.event.create({
      data: {
        slug: overrides.slug ?? 'review-night',
        organizerId,
        title: 'Review Night',
        description: 'Regression coverage for the code review findings.',
        category: 'SOCIAL_PARTY',
        status: 'PUBLISHED',
        capacity: overrides.capacity === undefined ? null : overrides.capacity,
        waitlistEnabled: true,
        startsAt: overrides.startsAt ?? new Date(now + 48 * HOUR),
        endsAt: overrides.endsAt ?? new Date(now + 52 * HOUR),
        venueName: 'Trenchard Hall',
        coverImageUrl: 'https://cdn.campuspulse.ng/covers/review.webp',
      },
    });
  }

  async function rsvp(email: string, eventId: string, extra: Record<string, unknown> = {}) {
    const res = await asUser(ctx.app, email)
      .post('/attendance/rsvps')
      .send({ eventId, ...extra })
      .expect(201);
    return bodyOf<CreateRsvpResponse>(res);
  }

  it('keeps accepting an offline batch when one scan is refused', async () => {
    const org = await createOrganizer();
    const event = await createEvent(org.id);
    const stays = await rsvp('stays@stu.ui.edu.ng', event.id);
    const leaves = await rsvp('leaves@stu.ui.edu.ng', event.id);
    await asUser(ctx.app, 'leaves@stu.ui.edu.ng')
      .delete(`/attendance/rsvps/${event.id}`)
      .expect(200);

    const scannedAt = new Date().toISOString();
    const res = await asUser(ctx.app, OWNER)
      .post('/attendance/check-in/batch')
      .send({
        checkIns: [
          { eventId: event.id, qrToken: leaves.qrToken, method: 'QR_SCAN', scannedAt },
          { eventId: event.id, qrToken: stays.qrToken, method: 'QR_SCAN', scannedAt },
          {
            eventId: event.id,
            qrToken: 'forged-token-that-is.not-signed',
            method: 'QR_SCAN',
            scannedAt,
          },
        ],
      });
    expect(res.status).toBeLessThan(300);

    const body = bodyOf<CheckInBatchResponse>(res);
    expect(body.results).toHaveLength(3);
    expect(body.results[0]).toBeNull();
    expect(body.results[1]?.duplicate).toBe(false);
    expect(body.results[2]).toBeNull();
    expect(body.rejected.map((r) => r.index)).toEqual([0, 2]);
    expect(body.rejected[0]?.statusCode).toBe(409);
    expect(body.rejected[1]?.statusCode).toBe(400);

    const refreshed = await ctx.prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(refreshed.checkInCount).toBe(1);
  });

  it('keeps RSVP showtime links and seat counts when showtimes are saved again', async () => {
    const org = await createOrganizer();
    const event = await createEvent(org.id);
    const startsAt = event.startsAt.toISOString();
    const [matinee] = await Promise.all([
      ctx.prisma.eventShowtime.create({
        data: { eventId: event.id, label: 'Matinee', startsAt: event.startsAt, capacity: 5 },
      }),
      ctx.prisma.eventShowtime.create({
        data: { eventId: event.id, label: 'Evening', startsAt: event.startsAt, capacity: 5 },
      }),
    ]);
    const booked = await rsvp('showgoer@stu.ui.edu.ng', event.id, { showtimeId: matinee.id });

    await asUser(ctx.app, OWNER)
      .patch(`/events/${event.id}`)
      .send({
        showtimes: [
          { label: 'Matinee', startsAt, capacity: 8 },
          { label: 'Evening', startsAt, capacity: 5 },
          { label: 'Late Show', startsAt, capacity: 5 },
        ],
      })
      .expect(200);

    const after = await ctx.prisma.rsvp.findUniqueOrThrow({ where: { id: booked.id } });
    expect(after.showtimeId).toBe(matinee.id);
    const matineeAfter = await ctx.prisma.eventShowtime.findUniqueOrThrow({
      where: { id: matinee.id },
    });
    expect(matineeAfter.rsvpCount).toBe(1);
    expect(matineeAfter.capacity).toBe(8);
    expect(await ctx.prisma.eventShowtime.count({ where: { eventId: event.id } })).toBe(3);

    // Dropping a showtime that still has an active RSVP is refused.
    await asUser(ctx.app, OWNER)
      .patch(`/events/${event.id}`)
      .send({ showtimes: [{ label: 'Evening', startsAt, capacity: 5 }] })
      .expect(409);
    expect(await ctx.prisma.eventShowtime.count({ where: { eventId: event.id } })).toBe(3);
  });

  it('leaves finished events out of the default feed', async () => {
    const org = await createOrganizer();
    const now = Date.now();
    await createEvent(org.id, {
      slug: 'last-week',
      startsAt: new Date(now - 100 * HOUR),
      endsAt: new Date(now - 96 * HOUR),
    });
    await createEvent(org.id, { slug: 'this-week' });

    const feed = bodyOf<FeedResponse>(await anon(ctx.app).get('/events/feed').expect(200));
    expect(feed.items.map((e) => e.slug)).toEqual(['this-week']);

    const from = encodeURIComponent(new Date(now - 200 * HOUR).toISOString());
    const windowed = bodyOf<FeedResponse>(
      await anon(ctx.app).get(`/events/feed?from=${from}`).expect(200),
    );
    expect(windowed.items.map((e) => e.slug)).toEqual(['last-week', 'this-week']);
  });

  it('sends a cancelled-then-returning attendee to the back of the waitlist', async () => {
    const org = await createOrganizer();
    const event = await createEvent(org.id, { capacity: 1 });
    await rsvp('first@stu.ui.edu.ng', event.id);
    expect((await rsvp('returner@stu.ui.edu.ng', event.id)).status).toBe('WAITLISTED');
    await asUser(ctx.app, 'returner@stu.ui.edu.ng')
      .delete(`/attendance/rsvps/${event.id}`)
      .expect(200);
    const patient = await rsvp('patient@stu.ui.edu.ng', event.id);
    expect((await rsvp('returner@stu.ui.edu.ng', event.id)).status).toBe('WAITLISTED');

    const res = await asUser(ctx.app, 'first@stu.ui.edu.ng')
      .delete(`/attendance/rsvps/${event.id}`)
      .expect(200);
    expect(bodyOf<CancelRsvpResponse>(res).promotedRsvpId).toBe(patient.id);
  });

  it('counts an ambassador RSVP once across cancel and re-RSVP', async () => {
    const org = await createOrganizer();
    const event = await createEvent(org.id);
    const creatorUser = await ctx.prisma.user.create({
      data: {
        email: 'creator@stu.ui.edu.ng',
        passwordHash: 'dev-auth-placeholder',
        displayName: 'Campus Creator',
        role: 'CREATOR',
      },
    });
    const creator = await ctx.prisma.creatorProfile.create({
      data: {
        userId: creatorUser.id,
        handle: 'campuscreator',
        displayName: 'Campus Creator',
        isVerified: true,
      },
    });
    const link = await ctx.prisma.ambassadorLink.create({
      data: { creatorId: creator.id, eventId: event.id, code: 'campuscreator-abc123' },
    });
    const count = async () =>
      (await ctx.prisma.ambassadorLink.findUniqueOrThrow({ where: { id: link.id } })).rsvpCount;

    const fan = 'fan@stu.ui.edu.ng';
    await rsvp(fan, event.id, { ambassadorCode: link.code });
    await asUser(ctx.app, fan).delete(`/attendance/rsvps/${event.id}`).expect(200);
    expect(await count()).toBe(0);
    await rsvp(fan, event.id, { ambassadorCode: link.code });
    expect(await count()).toBe(1);
  });

  it('notifies attendees once when an event is cancelled twice', async () => {
    const org = await createOrganizer();
    const event = await createEvent(org.id);
    await rsvp('guest@stu.ui.edu.ng', event.id);

    const emitted: unknown[] = [];
    ctx.app.get(EventEmitter2).on('event.cancelled', (payload: unknown) => emitted.push(payload));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await asUser(ctx.app, OWNER)
        .post(`/events/${event.id}/cancel`)
        .send({ reason: 'Venue flooded' });
      expect(res.status).toBeLessThan(300);
    }
    await queueService.waitForIdle();

    expect(emitted).toHaveLength(1);
    const emails = emailAdapter.getSentMessages().filter((m) => m.template === 'event-cancelled');
    expect(emails).toHaveLength(1);
  });

  it('tells attendees when only the venue changes', async () => {
    const org = await createOrganizer();
    const event = await createEvent(org.id);
    await rsvp('mover@stu.ui.edu.ng', event.id);
    emailAdapter.clearSentMessages();

    await asUser(ctx.app, OWNER)
      .patch(`/events/${event.id}`)
      .send({ venueName: 'SUB Main Hall' })
      .expect(200);
    await queueService.waitForIdle();

    const emails = emailAdapter.getSentMessages().filter((m) => m.template === 'event-updated');
    expect(emails).toHaveLength(1);
    expect(emails[0]?.text).toContain('Trenchard Hall to SUB Main Hall');

    const inbox = bodyOf<NotificationsResponse>(
      await asUser(ctx.app, 'mover@stu.ui.edu.ng').get('/notifications').expect(200),
    );
    expect(inbox.items.some((n) => n.title.startsWith('Venue Updated'))).toBe(true);

    // An edit that changes neither time nor venue stays quiet.
    emailAdapter.clearSentMessages();
    await asUser(ctx.app, OWNER)
      .patch(`/events/${event.id}`)
      .send({ dressCode: 'All white' })
      .expect(200);
    await queueService.waitForIdle();
    expect(emailAdapter.getSentMessages()).toHaveLength(0);
  });

  it('promotes the waitlist when capacity is raised and refuses capacity below RSVPs', async () => {
    const org = await createOrganizer();
    const event = await createEvent(org.id, { capacity: 1 });
    await rsvp('in@stu.ui.edu.ng', event.id);
    const waiting = await rsvp('waiting@stu.ui.edu.ng', event.id);
    const stillWaiting = await rsvp('still.waiting@stu.ui.edu.ng', event.id);
    expect(waiting.status).toBe('WAITLISTED');

    await asUser(ctx.app, OWNER).patch(`/events/${event.id}`).send({ capacity: 2 }).expect(200);

    const promoted = await ctx.prisma.rsvp.findUniqueOrThrow({ where: { id: waiting.id } });
    expect(promoted.status).toBe('CONFIRMED');
    const notPromoted = await ctx.prisma.rsvp.findUniqueOrThrow({ where: { id: stillWaiting.id } });
    expect(notPromoted.status).toBe('WAITLISTED');
    const refreshed = await ctx.prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(refreshed.rsvpCount).toBe(2);

    await asUser(ctx.app, OWNER).patch(`/events/${event.id}`).send({ capacity: 1 }).expect(400);
  });

  it('suggests hall mates even when they are not among the oldest accounts', async () => {
    const hall = 'Queen Elizabeth II Hall';
    await ctx.prisma.user.createMany({
      data: Array.from({ length: 35 }, (_, i) => ({
        email: `early.${i}@stu.ui.edu.ng`,
        passwordHash: 'dev-auth-placeholder',
        displayName: `Early Bird ${String(i).padStart(2, '0')}`,
        createdAt: new Date(Date.now() - (100 - i) * HOUR),
      })),
    });
    const hallMate = await ctx.prisma.user.create({
      data: {
        email: 'hallmate@stu.ui.edu.ng',
        passwordHash: 'dev-auth-placeholder',
        displayName: 'Late Hall Mate',
        hall,
      },
    });
    await ctx.prisma.user.create({
      data: {
        email: 'viewer@stu.ui.edu.ng',
        passwordHash: 'dev-auth-placeholder',
        displayName: 'Viewer',
        hall,
      },
    });

    const friends = bodyOf<FriendsResponse>(
      await asUser(ctx.app, 'viewer@stu.ui.edu.ng').get('/friends').expect(200),
    );
    const suggested = friends.items.filter((f) => f.status === 'SUGGESTED');
    expect(suggested[0]?.user.id).toBe(hallMate.id);
    expect(suggested).toHaveLength(30);
  });
});
