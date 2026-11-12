import { JwtService } from '@nestjs/jwt';
import type { Response } from 'supertest';
import { seedDatabase } from '../prisma/seed';
import {
  OrganizerDashboardResponse,
  ManagedEventsResponse,
  ManagedEvent,
  FeedResponse,
  CreatorAmbassadorLinksResponse,
} from '../src/contract';
import {
  type BootstrappedTestApp,
  createTestApp,
  truncateDatabase,
  withToken,
  anon,
} from './utils/app';

describe('Private organizer management reads [S5-01]', () => {
  let ctx: BootstrappedTestApp;
  beforeAll(async () => {
    ctx = await createTestApp({ devAuthEnabled: false });
  });
  beforeEach(async () => {
    await truncateDatabase(ctx.prisma);
    await seedDatabase(ctx.prisma);
  });
  afterAll(async () => {
    await ctx?.close();
  });
  async function caller(email: string) {
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
    const token = ctx.app.get(JwtService).sign({ sub: user.id }, { expiresIn: '15m' });
    return withToken(ctx.app, token);
  }
  const organizerId = '11111111-1111-4111-8111-111111111101';
  it('updates parent relationships, requires renewed cross-organizer approval, and can unlink drafts', async () => {
    const owner = await caller('sigma.owner@stu.ui.edu.ng');
    const ownParent = await ctx.prisma.event.findFirstOrThrow({
      where: { organizerId, status: 'PUBLISHED' },
    });
    const foreignParent = await ctx.prisma.event.findFirstOrThrow({
      where: { organizerId: { not: organizerId }, status: 'PUBLISHED' },
    });
    const created = await owner
      .post('/events')
      .send({
        organizerId,
        title: 'Editable relationship',
        description: 'Synthetic draft relationship acceptance',
        category: 'SOCIAL_PARTY',
        startsAt: '2030-11-20T18:00:00.000Z',
        endsAt: '2030-11-20T22:00:00.000Z',
        venueName: 'Synthetic SUB',
        coverImageUrl: 'https://example.test/cover.png',
      })
      .expect(201);
    const child = created.body as { id: string };
    const read = () => ctx.prisma.event.findUniqueOrThrow({ where: { id: child.id } });
    await owner
      .patch(`/events/${child.id}`)
      .send({ parentEventId: ownParent.id, linkType: 'AFTER_PARTY' })
      .expect(200);
    expect(await read()).toMatchObject({
      parentEventId: ownParent.id,
      linkType: 'AFTER_PARTY',
      parentLinkApproved: true,
    });
    await owner
      .patch(`/events/${child.id}`)
      .send({ parentEventId: foreignParent.id, linkType: 'AFTER_PARTY' })
      .expect(200);
    expect(await read()).toMatchObject({
      parentEventId: foreignParent.id,
      parentLinkApproved: false,
    });
    await owner.patch(`/events/${child.id}`).send({ title: 'Unrelated title edit' }).expect(200);
    expect((await read()).parentLinkApproved).toBe(false);
    await owner
      .patch(`/events/${child.id}`)
      .send({ parentEventId: ownParent.id, linkType: 'SERIES_CHILD' })
      .expect(200);
    expect(await read()).toMatchObject({
      parentEventId: ownParent.id,
      linkType: 'SERIES_CHILD',
      parentLinkApproved: true,
    });
    await owner
      .patch(`/events/${child.id}`)
      .send({ parentEventId: null, linkType: null })
      .expect(200);
    expect(await read()).toMatchObject({
      parentEventId: null,
      linkType: null,
      parentLinkApproved: true,
    });
    await owner
      .patch(`/events/${child.id}`)
      .send({ parentEventId: child.id, linkType: 'AFTER_PARTY' })
      .expect(400);
  });
  it('lists private drafts and preserves editable block fields without publishing them', async () => {
    const owner = await caller('sigma.owner@stu.ui.edu.ng');
    const draft = await ctx.prisma.event.create({
      data: {
        organizerId,
        title: 'Private draft',
        slug: 'private-draft',
        description: 'Draft description',
        category: 'SOCIAL_PARTY',
        startsAt: new Date('2027-01-01T18:00:00Z'),
        endsAt: new Date('2027-01-01T21:00:00Z'),
        venueName: 'SUB',
        parentEventId: '22222222-2222-4222-8222-222222222201',
        afterPartyAccess: 'CHECKED_IN_ONLY',
      },
    });
    const dashboard = await owner.get(`/organizers/${organizerId}/dashboard`).expect(200);
    const overview = OrganizerDashboardResponse.parse(dashboard.body as unknown);
    expect(overview.membership.role).toBe('OWNER');
    expect(overview.kpis).toEqual(expect.objectContaining({ followers: expect.any(Number) }));
    const page = await owner.get(`/organizers/${organizerId}/managed-events?limit=1`).expect(200);
    expect(ManagedEventsResponse.parse(page.body as unknown).items).toHaveLength(1);
    expect(ManagedEventsResponse.parse(page.body as unknown).nextCursor).toEqual(
      expect.any(String),
    );
    const ids = new Set<string>();
    let cursor: string | null = null;
    do {
      const res: Response = await owner
        .get(
          `/organizers/${organizerId}/managed-events?limit=1${cursor ? `&cursor=${cursor}` : ''}`,
        )
        .expect(200);
      const data = ManagedEventsResponse.parse(res.body as unknown);
      for (const event of data.items) {
        expect(ids.has(event.id)).toBe(false);
        ids.add(event.id);
      }
      cursor = data.nextCursor;
    } while (cursor);
    expect(ids.has(draft.id)).toBe(true);
    const detail = await owner.get(`/events/${draft.id}/manage`).expect(200);
    expect(ManagedEvent.parse(detail.body as unknown)).toMatchObject({
      id: draft.id,
      draft: { parentEventId: draft.parentEventId, afterPartyAccess: 'CHECKED_IN_ONLY' },
    });
    const publicEvents = await anon(ctx.app).get('/organizers/sigma-club-ui/events').expect(200);
    expect(
      FeedResponse.parse(publicEvents.body as unknown).items.some((e) => e.id === draft.id),
    ).toBe(false);
  });
  it('denies unrelated JWTs and door-only grants on every private management read', async () => {
    const event = await ctx.prisma.event.findFirstOrThrow({ where: { organizerId } });
    const attendee = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'tobi@stu.ui.edu.ng' },
    });
    const organizer = await ctx.prisma.organizer.findUniqueOrThrow({ where: { id: organizerId } });
    await ctx.prisma.doorStaffGrant.upsert({
      where: { eventId_userId: { eventId: event.id, userId: attendee.id } },
      update: { expiresAt: new Date(Date.now() + 3600000) },
      create: {
        eventId: event.id,
        userId: attendee.id,
        grantedById: organizer.ownerId,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    for (const email of ['tobi@stu.ui.edu.ng', 'sports.owner@stu.ui.edu.ng']) {
      const outsider = await caller(email);
      for (const path of [
        `/organizers/${organizerId}/dashboard`,
        `/organizers/${organizerId}/managed-events`,
        `/events/${event.id}/manage`,
        `/organizers/${organizerId}/team`,
      ]) {
        await outsider.get(path).expect(403);
      }
    }
    await anon(ctx.app).get(`/organizers/${organizerId}/dashboard`).expect(401);
  });
  it('returns only the current creator links and never exposes another creator counters', async () => {
    const creator = await ctx.prisma.creatorProfile.findFirstOrThrow();
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: creator.userId } });
    const res = await (await caller(user.email)).get('/creators/me/ambassador-links').expect(200);
    const data = CreatorAmbassadorLinksResponse.parse(res.body as unknown);
    expect(data.creator.id).toBe(creator.id);
    const rows = await ctx.prisma.ambassadorLink.findMany({ where: { creatorId: creator.id } });
    expect(data.items.map((x) => x.id).sort()).toEqual(rows.map((x) => x.id).sort());
    await (
      await caller('sports.owner@stu.ui.edu.ng')
    )
      .get('/creators/me/ambassador-links')
      .expect(404);
  });
});
