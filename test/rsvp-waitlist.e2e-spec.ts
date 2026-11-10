import type { CreateRsvpResponse } from '../src/contract';
import {
  asUser,
  bodyOf,
  createTestApp,
  truncateDatabase,
  type BootstrappedTestApp,
} from './utils/app';

const DEV_HASH = 'dev-auth-placeholder';

interface TicketsPayload {
  items: Array<{
    rsvp: CreateRsvpResponse;
    event: { id: string; slug: string; parentEventSlug?: string | null };
  }>;
  yourNightGroups?: Array<{
    key: string;
    eventIds: string[];
  }>;
}

describe('Transactional RSVPs, Ed25519 QR, Waitlist Promotion, Tickets & Ambassadors (S3-01 e2e)', () => {
  let ctx: BootstrappedTestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await truncateDatabase(ctx.prisma);
  });

  it('enforces exact capacity under 50 simultaneous RSVPs (10 CONFIRMED + 40 WAITLISTED) and promotes oldest waitlisted on cancel', async () => {
    const owner = await ctx.prisma.user.create({
      data: {
        email: 'owner@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Sigma Owner',
        role: 'ORGANIZER',
      },
    });
    const org = await ctx.prisma.organizer.create({
      data: {
        ownerId: owner.id,
        slug: 'sigma-club-ui',
        name: 'Sigma Club UI',
        isVerified: true,
      },
    });

    const now = Date.now();
    const event = await ctx.prisma.event.create({
      data: {
        slug: 'concurrency-gala',
        organizerId: org.id,
        title: 'Concurrency Capacity Gala',
        description: 'Testing atomic FOR UPDATE capacity enforcement.',
        category: 'SOCIAL_PARTY',
        status: 'PUBLISHED',
        capacity: 10,
        waitlistEnabled: true,
        startsAt: new Date(now + 4 * 3600_000),
        endsAt: new Date(now + 8 * 3600_000),
        venueName: 'Trenchard Hall',
        coverImageUrl: 'https://cdn.campuspulse.ng/covers/gala.webp',
      },
    });

    // Pre-create 50 student users so DevAuth doesn't serialize user auto-creation before hitting the RSVP lock
    const attendees = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        ctx.prisma.user.create({
          data: {
            email: `concurrent.${String(i + 1).padStart(2, '0')}@stu.ui.edu.ng`,
            passwordHash: DEV_HASH,
            displayName: `Student ${i + 1}`,
            isVerifiedStudent: true,
          },
        }),
      ),
    );

    const responses = await Promise.all(
      attendees.map((u) =>
        asUser(ctx.app, u.email).post('/attendance/rsvps').send({ eventId: event.id }),
      ),
    );

    for (const res of responses) {
      expect(res.status).toBe(201);
    }

    const bodies = responses.map((r) => bodyOf<CreateRsvpResponse>(r));
    const confirmed = bodies.filter((b) => b.status === 'CONFIRMED');
    const waitlisted = bodies.filter((b) => b.status === 'WAITLISTED');

    expect(confirmed).toHaveLength(10);
    expect(waitlisted).toHaveLength(40);

    const refreshedEvent = await ctx.prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(refreshedEvent.rsvpCount).toBe(10);

    // Find the oldest waitlisted RSVP in DB
    const oldestWaitlisted = await ctx.prisma.rsvp.findFirstOrThrow({
      where: { eventId: event.id, status: 'WAITLISTED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    // Cancel one CONFIRMED RSVP and verify oldest waitlisted is promoted in the same transaction
    const cancellerId = confirmed[0]!.userId;
    const canceller = attendees.find((a) => a.id === cancellerId)!;

    await asUser(ctx.app, canceller.email).delete(`/attendance/rsvps/${event.id}`).expect(200);

    const promoted = await ctx.prisma.rsvp.findUniqueOrThrow({
      where: { id: oldestWaitlisted.id },
    });
    expect(promoted.status).toBe('CONFIRMED');

    const postPromoteEvent = await ctx.prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(postPromoteEvent.rsvpCount).toBe(10);
  });

  it('enforces studentsOnly & CHECKED_IN_ONLY after-party gating, attributes ambassador/invite codes, and groups Your Night tickets', async () => {
    const owner = await ctx.prisma.user.create({
      data: {
        email: 'club@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Club Owner',
        role: 'ORGANIZER',
      },
    });
    const org = await ctx.prisma.organizer.create({
      data: {
        ownerId: owner.id,
        slug: 'havana-club',
        name: 'Havana Club UI',
        isVerified: true,
      },
    });

    const creatorUser = await ctx.prisma.user.create({
      data: {
        email: 'bisola@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Bisola',
        isVerifiedStudent: true,
      },
    });
    await ctx.prisma.creatorProfile.create({
      data: {
        userId: creatorUser.id,
        handle: 'bisola',
        displayName: 'Bisola',
        isVerified: true,
      },
    });

    const verifiedStudent = await ctx.prisma.user.create({
      data: {
        email: 'tobi@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Tobi Adeyemi',
        isVerifiedStudent: true,
      },
    });
    const guestUser = await ctx.prisma.user.create({
      data: {
        email: 'guest@example.com',
        passwordHash: DEV_HASH,
        displayName: 'Guest Visitor',
        isVerifiedStudent: false,
      },
    });

    const now = Date.now();
    const mainEvent = await ctx.prisma.event.create({
      data: {
        slug: 'havana-main',
        organizerId: org.id,
        title: 'Havana Main Concert',
        description: 'Verified UI students main show.',
        category: 'SOCIAL_PARTY',
        status: 'PUBLISHED',
        studentsOnly: true,
        startsAt: new Date(now + 2 * 3600_000),
        endsAt: new Date(now + 5 * 3600_000),
        venueName: 'SUB Field',
        coverImageUrl: 'https://cdn.campuspulse.ng/covers/havana.webp',
        showtimes: {
          create: [
            {
              label: 'Early Set',
              startsAt: new Date(now + 2 * 3600_000),
              capacity: 5,
            },
          ],
        },
      },
      include: { showtimes: true },
    });

    const afterParty = await ctx.prisma.event.create({
      data: {
        slug: 'havana-after-dark',
        organizerId: org.id,
        title: 'Havana After Dark',
        description: 'Official after-party for checked-in attendees.',
        category: 'SOCIAL_PARTY',
        status: 'PUBLISHED',
        parentEventId: mainEvent.id,
        linkType: 'AFTER_PARTY',
        parentLinkApproved: true,
        afterPartyAccess: 'CHECKED_IN_ONLY',
        startsAt: new Date(now + 5 * 3600_000),
        endsAt: new Date(now + 9 * 3600_000),
        venueName: 'UI Senior Staff Club Lounge',
        coverImageUrl: 'https://cdn.campuspulse.ng/covers/after.webp',
      },
    });

    // 1. Verified creator generates ambassador link; unverified non-creator gets 403
    await asUser(ctx.app, verifiedStudent.email)
      .post('/attendance/ambassador-links')
      .send({ eventId: mainEvent.id })
      .expect(403);

    const ambRes = await asUser(ctx.app, creatorUser.email)
      .post('/attendance/ambassador-links')
      .send({ eventId: mainEvent.id })
      .expect(201);
    const ambBody = bodyOf<{ id: string; code: string }>(ambRes);
    expect(ambBody.code).toContain('bisola');

    const invite = await ctx.prisma.eventInvite.create({
      data: {
        eventId: mainEvent.id,
        inviterId: creatorUser.id,
        inviteCode: 'INV-HAVANA-1',
      },
    });

    // 2. Unverified guest rejected by studentsOnly (403)
    await asUser(ctx.app, guestUser.email)
      .post('/attendance/rsvps')
      .send({ eventId: mainEvent.id })
      .expect(403);

    // 3. Verified student RSVPs with showtimeId + ambassadorCode + inviteCode
    const showtimeId = mainEvent.showtimes[0]!.id;
    const rsvpRes = await asUser(ctx.app, verifiedStudent.email)
      .post('/attendance/rsvps')
      .send({
        eventId: mainEvent.id,
        showtimeId,
        ambassadorCode: ambBody.code,
        inviteCode: invite.inviteCode,
      })
      .expect(201);
    const mainRsvp = bodyOf<CreateRsvpResponse>(rsvpRes);
    expect(mainRsvp.status).toBe('CONFIRMED');

    const updatedAmb = await ctx.prisma.ambassadorLink.findUniqueOrThrow({
      where: { id: ambBody.id },
    });
    const updatedInvite = await ctx.prisma.eventInvite.findUniqueOrThrow({
      where: { id: invite.id },
    });
    const updatedShowtime = await ctx.prisma.eventShowtime.findUniqueOrThrow({
      where: { id: showtimeId },
    });
    expect(updatedAmb.rsvpCount).toBe(1);
    expect(updatedInvite.acceptedCount).toBe(1);
    expect(updatedShowtime.rsvpCount).toBe(1);

    // 4. CHECKED_IN_ONLY after-party rejects RSVP until checked in at parent event
    await asUser(ctx.app, verifiedStudent.email)
      .post('/attendance/rsvps')
      .send({ eventId: afterParty.id })
      .expect(403);

    await ctx.prisma.checkIn.create({
      data: {
        eventId: mainEvent.id,
        rsvpId: mainRsvp.id,
        method: 'QR_SCAN',
        scannedAt: new Date(),
        checkedInById: owner.id,
      },
    });

    const afterRsvpRes = await asUser(ctx.app, verifiedStudent.email)
      .post('/attendance/rsvps')
      .send({ eventId: afterParty.id })
      .expect(201);
    expect(bodyOf<CreateRsvpResponse>(afterRsvpRes).status).toBe('CONFIRMED');

    // 5. GET /attendance/me/tickets returns both passes + Your Night grouping
    const ticketsRes = await asUser(ctx.app, verifiedStudent.email)
      .get('/attendance/me/tickets')
      .expect(200);
    const wallet = bodyOf<TicketsPayload>(ticketsRes);
    expect(wallet.items).toHaveLength(2);
    expect(wallet.yourNightGroups).toBeDefined();
    expect(wallet.yourNightGroups?.[0]?.eventIds).toEqual([mainEvent.id, afterParty.id]);

    // 6. Interested bookmark + moderation report endpoints
    await asUser(ctx.app, verifiedStudent.email)
      .post(`/attendance/interested/${mainEvent.id}`)
      .expect(200);
    expect(await ctx.prisma.eventInterest.count({ where: { eventId: mainEvent.id } })).toBe(1);

    await asUser(ctx.app, verifiedStudent.email)
      .delete(`/attendance/interested/${mainEvent.id}`)
      .expect(200);
    expect(await ctx.prisma.eventInterest.count({ where: { eventId: mainEvent.id } })).toBe(0);

    await asUser(ctx.app, verifiedStudent.email)
      .post('/reports')
      .send({ eventId: mainEvent.id, reason: 'Sound check noise notice check' })
      .expect(201);
    expect(await ctx.prisma.moderationReport.count({ where: { targetId: mainEvent.id } })).toBe(1);
  });
});
