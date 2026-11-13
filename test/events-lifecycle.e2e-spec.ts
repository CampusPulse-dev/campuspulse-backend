import { EventEmitter2 } from '@nestjs/event-emitter';
import { seedDatabase } from '../prisma/seed';
import type { AttendeePreferences, EventPublic, UserPublic } from '../src/contract';
import { OrganizerAccessService } from '../src/modules/identity/organizer-access.service';
import {
  anon,
  asUser,
  bodyOf,
  createTestApp,
  truncateDatabase,
  type BootstrappedTestApp,
} from './utils/app';

describe('Events lifecycle & dummy auth (S2-01)', () => {
  let ctx: BootstrappedTestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await truncateDatabase(ctx.prisma);
    await seedDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('DevAuthGuard & Users /me', () => {
    it('returns 401 when X-Dev-User is missing on protected routes', async () => {
      await anon(ctx.app).get('/users/me').expect(401);
      await anon(ctx.app)
        .post('/events')
        .send({
          title: 'Blocked Draft',
          description: 'No auth header',
          category: 'SOCIAL_PARTY',
          startsAt: '2027-02-01T19:00:00.000Z',
          endsAt: '2027-02-01T23:00:00.000Z',
          venueName: 'SUB Foyer',
          coverImageUrl: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30',
        })
        .expect(401);
    });

    it('returns 401 when DEV_AUTH_ENABLED is false even if X-Dev-User is set', async () => {
      const disabledCtx = await createTestApp({ devAuthEnabled: false });
      try {
        await asUser(disabledCtx.app, 'tobi@stu.ui.edu.ng').get('/users/me').expect(401);
      } finally {
        await disabledCtx.close();
      }
    });

    it('auto-creates unknown emails as ATTENDEE and supports profile/privacy updates', async () => {
      const meRes = await asUser(ctx.app, 'freshman@stu.ui.edu.ng').get('/users/me').expect(200);
      expect(bodyOf<UserPublic>(meRes)).toMatchObject({
        displayName: 'freshman',
        role: 'ATTENDEE',
        isVerifiedStudent: false,
      });

      const patchRes = await asUser(ctx.app, 'freshman@stu.ui.edu.ng')
        .patch('/users/me')
        .send({ displayName: 'Freshman Ola' })
        .expect(200);
      expect(bodyOf<UserPublic>(patchRes).displayName).toBe('Freshman Ola');

      const prefRes = await asUser(ctx.app, 'freshman@stu.ui.edu.ng')
        .put('/users/me/preferences')
        .send({
          stealthRsvp: true,
          hideFromFriends: true,
          mutedCategories: ['RECOMMENDATION'],
          theme: 'dark',
        })
        .expect(200);
      expect(bodyOf<AttendeePreferences>(prefRes).privacy).toMatchObject({
        stealthRsvp: true,
        hideFromFriends: true,
        mutedCategories: ['RECOMMENDATION'],
        theme: 'dark',
      });
    });
  });

  describe('Event CRUD, templates, draft visibility, publish, cancel, fixture & after-party links', () => {
    it('creates DRAFT events with template blocks, hides drafts from non-members, publishes for verified organizers, and blocks unverified publish', async () => {
      // Seeded verified club owner: sigma.owner@stu.ui.edu.ng (Sigma Club UI)
      const createPlayRes = await asUser(ctx.app, 'sigma.owner@stu.ui.edu.ng')
        .post('/events')
        .send({
          title: 'Palmwine Drinkard Stage Adaptation',
          description: 'Two-show stage play at Arts Theatre.',
          category: 'PERFORMANCE_ARTS',
          template: 'PLAY_CULTURAL',
          tonightMood: 'CHILL',
          startsAt: '2027-03-10T17:00:00.000Z',
          endsAt: '2027-03-10T22:00:00.000Z',
          venueName: 'Wole Soyinka Arts Theatre',
          venueDetail: 'Main Auditorium',
          coverImageUrl: 'https://images.unsplash.com/photo-1503095396549-807759245b35',
          capacity: 200,
          studentsOnly: true,
          dressCode: 'Smart traditional',
          castAndCrew: ['Akin — Lead', 'Bisi — Stage Manager'],
          showtimes: [
            {
              label: 'Matinee 5 PM',
              startsAt: '2027-03-10T17:00:00.000Z',
              capacity: 100,
            },
            {
              label: 'Gala 8 PM',
              startsAt: '2027-03-10T20:00:00.000Z',
              capacity: 100,
            },
          ],
        })
        .expect(201);

      const createdPlay = bodyOf<EventPublic>(createPlayRes);
      const draftSlug = createdPlay.slug;
      const draftId = createdPlay.id;
      expect(createdPlay.status).toBe('DRAFT');
      expect(createdPlay.template).toBe('PLAY_CULTURAL');
      expect(createdPlay.showtimes).toHaveLength(2);
      expect(createdPlay.castAndCrew).toEqual(['Akin — Lead', 'Bisi — Stage Manager']);

      // Non-members and anonymous visitors MUST get 404 on DRAFT events.
      await anon(ctx.app).get(`/events/${draftSlug}`).expect(404);
      await asUser(ctx.app, 'tobi@stu.ui.edu.ng').get(`/events/${draftSlug}`).expect(404);

      // Club OWNER and MANAGER can preview the DRAFT by slug.
      await asUser(ctx.app, 'sigma.owner@stu.ui.edu.ng').get(`/events/${draftSlug}`).expect(200);
      await asUser(ctx.app, 'sigma.manager@stu.ui.edu.ng').get(`/events/${draftSlug}`).expect(200);

      // Stranger cannot publish or edit.
      await asUser(ctx.app, 'tobi@stu.ui.edu.ng').post(`/events/${draftId}/publish`).expect(403);

      // Verified club manager CAN publish -> now visible to anonymous visitors!
      const pubRes = await asUser(ctx.app, 'sigma.manager@stu.ui.edu.ng')
        .post(`/events/${draftId}/publish`)
        .expect(200);
      expect(bodyOf<EventPublic>(pubRes).status).toBe('PUBLISHED');

      const publicGet = await anon(ctx.app).get(`/events/${draftSlug}`).expect(200);
      const publicPlay = bodyOf<EventPublic>(publicGet);
      expect(publicPlay.status).toBe('PUBLISHED');
      expect(publicPlay.showtimes).toHaveLength(2);

      // Unverified organizer cannot publish!
      const unverifiedOwner = await ctx.prisma.user.create({
        data: {
          email: 'unverified.club@stu.ui.edu.ng',
          passwordHash: 'dev-only',
          displayName: 'Unverified Club Lead',
          role: 'ORGANIZER',
        },
      });
      const unverifiedOrg = await ctx.prisma.organizer.create({
        data: {
          slug: 'unverified-society',
          name: 'Unverified Society',
          isVerified: false,
          ownerId: unverifiedOwner.id,
          members: {
            create: { userId: unverifiedOwner.id, role: 'OWNER' },
          },
        },
      });

      const unverifiedDraft = await asUser(ctx.app, 'unverified.club@stu.ui.edu.ng')
        .post('/events')
        .send({
          organizerId: unverifiedOrg.id,
          title: 'Unverified Mixer',
          description: 'Cannot go live yet',
          category: 'CLUB_SOCIETY',
          startsAt: '2027-03-12T18:00:00.000Z',
          endsAt: '2027-03-12T21:00:00.000Z',
          venueName: 'Kellan Lawn',
          coverImageUrl: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622',
        })
        .expect(201);

      await asUser(ctx.app, 'unverified.club@stu.ui.edu.ng')
        .post(`/events/${bodyOf<EventPublic>(unverifiedDraft).id}/publish`)
        .expect(403);
    });

    it('emits domain events on update and cancel, and updates live fixture scores', async () => {
      const emitter = ctx.app.get(EventEmitter2);
      const updatedEvents: unknown[] = [];
      const cancelledEvents: unknown[] = [];
      emitter.on('event.updated', (payload: unknown) => updatedEvents.push(payload));
      emitter.on('event.cancelled', (payload: unknown) => cancelledEvents.push(payload));

      const matchRes = await asUser(ctx.app, 'sports.owner@stu.ui.edu.ng')
        .post('/events')
        .send({
          title: 'Inter-Hall Quarterfinal: Mellanby vs Tedder',
          description: 'Knockout football clash under the floodlights.',
          category: 'SPORTS_RECREATION',
          template: 'MATCH_TOURNAMENT',
          tonightMood: 'WATCH_GAME',
          startsAt: '2027-03-15T16:00:00.000Z',
          endsAt: '2027-03-15T18:30:00.000Z',
          venueName: 'SUB Pitch',
          coverImageUrl: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018',
          fixture: {
            homeTeam: 'Mellanby Hall',
            awayTeam: 'Tedder Hall',
          },
        })
        .expect(201);

      const matchId = bodyOf<EventPublic>(matchRes).id;
      await asUser(ctx.app, 'sports.owner@stu.ui.edu.ng')
        .post(`/events/${matchId}/publish`)
        .expect(200);

      // Update live fixture score
      const fixtureRes = await asUser(ctx.app, 'sports.manager@stu.ui.edu.ng')
        .patch(`/events/${matchId}/fixture`)
        .send({
          homeScore: 2,
          awayScore: 1,
          isLive: true,
          periodLabel: '2nd Half · 74’',
        })
        .expect(200);
      expect(bodyOf<EventPublic>(fixtureRes).fixture).toEqual({
        homeTeam: 'Mellanby Hall',
        awayTeam: 'Tedder Hall',
        homeScore: 2,
        awayScore: 1,
        isLive: true,
        periodLabel: '2nd Half · 74’',
      });

      // Patch event start time -> emits event.updated
      await asUser(ctx.app, 'sports.owner@stu.ui.edu.ng')
        .patch(`/events/${matchId}`)
        .send({ startsAt: '2027-03-15T16:30:00.000Z' })
        .expect(200);
      expect(updatedEvents.length).toBeGreaterThanOrEqual(1);

      // Cancel requires reason
      await asUser(ctx.app, 'sports.owner@stu.ui.edu.ng')
        .post(`/events/${matchId}/cancel`)
        .send({ reason: '' })
        .expect(400);

      const cancelRes = await asUser(ctx.app, 'sports.owner@stu.ui.edu.ng')
        .post(`/events/${matchId}/cancel`)
        .send({ reason: 'Waterlogged pitch after heavy rain' })
        .expect(200);
      expect(bodyOf<EventPublic>(cancelRes).status).toBe('CANCELLED');
      expect(cancelledEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('gates cross-organizer after-party links until parent OWNER approves', async () => {
      // Create & publish parent event under Theatre Troupe (theatre.owner@stu.ui.edu.ng)
      const parentRes = await asUser(ctx.app, 'theatre.owner@stu.ui.edu.ng')
        .post('/events')
        .send({
          title: 'UI Tech Demo Day',
          description: 'Student builders showcase projects.',
          category: 'ACADEMIC_CONFERENCE',
          startsAt: '2027-04-01T14:00:00.000Z',
          endsAt: '2027-04-01T18:00:00.000Z',
          venueName: 'Trenchard Hall',
          coverImageUrl: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87',
        })
        .expect(201);
      const parentCreated = bodyOf<EventPublic>(parentRes);
      const parentId = parentCreated.id;
      const parentSlug = parentCreated.slug;
      await asUser(ctx.app, 'theatre.owner@stu.ui.edu.ng')
        .post(`/events/${parentId}/publish`)
        .expect(200);

      // Create & publish cross-organizer after-party under Sigma Club (sigma.owner@stu.ui.edu.ng)
      const childRes = await asUser(ctx.app, 'sigma.owner@stu.ui.edu.ng')
        .post('/events')
        .send({
          title: 'Demo Day Rooftop Afters',
          description: 'Builders unwind after pitches.',
          category: 'SOCIAL_PARTY',
          template: 'CONCERT_PARTY',
          startsAt: '2027-04-01T20:00:00.000Z',
          endsAt: '2027-04-02T01:00:00.000Z',
          venueName: 'Agbowo Lounge',
          coverImageUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819',
          parentEventId: parentId,
          linkType: 'AFTER_PARTY',
          afterPartyAccess: 'CHECKED_IN_ONLY',
          lineup: [{ performerName: 'DJ Bisola', role: 'Headliner', setTime: '22:00' }],
        })
        .expect(201);
      const childCreated = bodyOf<EventPublic>(childRes);
      const childId = childCreated.id;
      const childSlug = childCreated.slug;
      await asUser(ctx.app, 'sigma.owner@stu.ui.edu.ng')
        .post(`/events/${childId}/publish`)
        .expect(200);

      // Before parent OWNER approves, parent event must NOT advertise the unapproved cross-org after-party.
      const beforeApprove = await anon(ctx.app).get(`/events/${parentSlug}`).expect(200);
      expect(bodyOf<EventPublic>(beforeApprove).linkedAfterParty).toBeNull();

      // Child owner or parent manager cannot approve cross-organizer link — only parent OWNER!
      await asUser(ctx.app, 'sigma.owner@stu.ui.edu.ng')
        .post(`/events/${childId}/approve-link`)
        .expect(403);
      await asUser(ctx.app, 'theatre.manager@stu.ui.edu.ng')
        .post(`/events/${childId}/approve-link`)
        .expect(403);

      // Parent OWNER approves
      await asUser(ctx.app, 'theatre.owner@stu.ui.edu.ng')
        .post(`/events/${childId}/approve-link`)
        .expect(200);

      const afterApprove = await anon(ctx.app).get(`/events/${parentSlug}`).expect(200);
      expect(bodyOf<EventPublic>(afterApprove).linkedAfterParty).toMatchObject({
        id: childId,
        slug: childSlug,
        title: 'Demo Day Rooftop Afters',
        accessRule: 'CHECKED_IN_ONLY',
      });

      const childPublic = await anon(ctx.app).get(`/events/${childSlug}`).expect(200);
      const childEvent = bodyOf<EventPublic>(childPublic);
      expect(childEvent.parentEventSlug).toBe(parentSlug);
      expect(childEvent.parentEventTitle).toBe('UI Tech Demo Day');
    });

    it('enforces OrganizerAccessService.assertDoorAccess for owners, managers, and unexpired door grants', async () => {
      const access = ctx.app.get(OrganizerAccessService);
      const event = await ctx.prisma.event.findFirstOrThrow({
        where: { status: 'PUBLISHED' },
        include: {
          organizer: { include: { members: { include: { user: true } } } },
        },
      });
      const owner = event.organizer.members.find((m) => m.role === 'OWNER')!.user;
      const attendee = await ctx.prisma.user.findUniqueOrThrow({
        where: { email: 'tobi@stu.ui.edu.ng' },
      });

      await expect(access.assertDoorAccess(owner.id, event.id)).resolves.toBeUndefined();
      await expect(access.assertDoorAccess(attendee.id, event.id)).rejects.toThrow();

      await ctx.prisma.doorStaffGrant.create({
        data: {
          eventId: event.id,
          userId: attendee.id,
          grantedById: owner.id,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      await expect(access.assertDoorAccess(attendee.id, event.id)).resolves.toBeUndefined();
    });
  });
});
