import { randomUUID } from 'node:crypto';
import type {
  AttendeePersona,
  AttendeePreferences,
  AttendeeSearchResponse,
  EventPublic,
  FeedResponse,
  FriendEntry,
  FriendsResponse,
} from '../src/contract';
import {
  anon,
  asUser,
  bodyOf,
  createTestApp,
  truncateDatabase,
  type BootstrappedTestApp,
} from './utils/app';

const DEV_HASH = 'dev-auth-placeholder';

describe('Friends graph, social privacy, search, persona & For You (S2-03 e2e)', () => {
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

  it('manages friend requests, accept/decline, and blocks on both Friendship IDs and suggested User IDs', async () => {
    const viewer = await ctx.prisma.user.create({
      data: {
        email: 'viewer@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Tobi Viewer',
        hall: 'Mellanby Hall',
        faculty: 'Technology',
        isVerifiedStudent: true,
      },
    });
    const sameHallPeer = await ctx.prisma.user.create({
      data: {
        email: 'peer.hall@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Kunle Hallmate',
        hall: 'Mellanby Hall',
        faculty: 'Science',
        isVerifiedStudent: true,
      },
    });
    const otherPeer = await ctx.prisma.user.create({
      data: {
        email: 'peer.other@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Zainab Campus',
        hall: 'Queen Idia Hall',
        faculty: 'Arts',
        isVerifiedStudent: true,
      },
    });
    const incomingPeer = await ctx.prisma.user.create({
      data: {
        email: 'peer.incoming@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Adaeze Incoming',
        hall: 'Tedder Hall',
        faculty: 'Technology',
        isVerifiedStudent: true,
      },
    });

    await ctx.prisma.friendship.create({
      data: {
        requesterId: incomingPeer.id,
        addresseeId: viewer.id,
        status: 'PENDING',
      },
    });

    // 1. GET /friends lists incoming request + suggestions with hallmate ranked ahead of unrelated cohort
    const listRes = await asUser(ctx.app, viewer.email).get('/friends').expect(200);
    const initial = bodyOf<FriendsResponse>(listRes).items;
    expect(initial.find((f) => f.user.id === incomingPeer.id)?.status).toBe('INCOMING');

    const suggestions = initial.filter((f) => f.status === 'SUGGESTED');
    expect(suggestions.map((s) => s.user.id)).toEqual([sameHallPeer.id, otherPeer.id]);

    // 2. Accept incoming request (requester cannot self-accept)
    const incomingEntry = initial.find((f) => f.user.id === incomingPeer.id)!;
    await asUser(ctx.app, incomingPeer.email)
      .post(`/friends/${incomingEntry.id}/respond`)
      .send({ action: 'ACCEPT' })
      .expect(403);

    const acceptRes = await asUser(ctx.app, viewer.email)
      .post(`/friends/${incomingEntry.id}/respond`)
      .send({ action: 'ACCEPT' })
      .expect(200);
    expect(bodyOf<FriendEntry>(acceptRes).status).toBe('ACCEPTED');

    // 3. Send friend request using frontend payload { userId, action: 'REQUEST' }, then target declines
    const reqRes = await asUser(ctx.app, viewer.email)
      .post('/friends/request')
      .send({ userId: sameHallPeer.id, action: 'REQUEST' })
      .expect(201);
    const outgoing = bodyOf<FriendEntry>(reqRes);
    expect(outgoing.status).toBe('OUTGOING');

    await asUser(ctx.app, sameHallPeer.email)
      .post(`/friends/${outgoing.id}/respond`)
      .send({ action: 'DECLINE' })
      .expect(200);

    // 4. Block a suggested user directly by their User.id (how Friends.tsx sends BLOCK on SUGGESTED rows)
    const blockRes = await asUser(ctx.app, viewer.email)
      .post(`/friends/${otherPeer.id}/respond`)
      .send({ action: 'BLOCK' })
      .expect(200);
    expect(bodyOf<FriendEntry>(blockRes).status).toBe('BLOCKED');

    // Blocked user cannot send request back and disappears from both /friends lists
    await asUser(ctx.app, otherPeer.email)
      .post('/friends/request')
      .send({ userId: viewer.id })
      .expect(403);

    const viewerAfter = bodyOf<FriendsResponse>(
      await asUser(ctx.app, viewer.email).get('/friends').expect(200),
    ).items;
    const otherAfter = bodyOf<FriendsResponse>(
      await asUser(ctx.app, otherPeer.email).get('/friends').expect(200),
    ).items;
    expect(viewerAfter.some((f) => f.user.id === otherPeer.id)).toBe(false);
    expect(otherAfter.some((f) => f.user.id === viewer.id)).toBe(false);
  });

  it('enforces FriendsGoing privacy rules across /events/feed and /events/:slug', async () => {
    const viewer = await ctx.prisma.user.create({
      data: {
        email: 'viewer@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Viewer',
      },
    });
    const clubOwner = await ctx.prisma.user.create({
      data: {
        email: 'owner@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Club Owner',
        role: 'ORGANIZER',
      },
    });

    const org = await ctx.prisma.organizer.create({
      data: {
        ownerId: clubOwner.id,
        slug: 'sigma-club',
        name: 'Sigma Club UI',
        isVerified: true,
      },
    });

    const now = Date.now();
    const event = await ctx.prisma.event.create({
      data: {
        slug: 'havana-privacy-test',
        organizerId: org.id,
        title: 'Havana Privacy Test',
        description: 'Testing mutual friends social proof privacy.',
        category: 'SOCIAL_PARTY',
        status: 'PUBLISHED',
        startsAt: new Date(now + 2 * 3600_000),
        endsAt: new Date(now + 6 * 3600_000),
        venueName: 'SUB Field',
        coverImageUrl: 'https://cdn.campuspulse.ng/covers/havana.webp',
      },
    });

    // Create 4 eligible mutual friends + 8 excluded users
    const mutuals = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        ctx.prisma.user.create({
          data: {
            email: `mutual${n}@stu.ui.edu.ng`,
            passwordHash: DEV_HASH,
            displayName: `Mutual ${n}`,
          },
        }),
      ),
    );
    for (const m of mutuals) {
      await ctx.prisma.friendship.create({
        data: { requesterId: viewer.id, addresseeId: m.id, status: 'ACCEPTED' },
      });
      await ctx.prisma.rsvp.create({
        data: {
          eventId: event.id,
          userId: m.id,
          status: 'CONFIRMED',
          qrToken: `tok-${randomUUID()}`,
        },
      });
    }

    const stranger = await ctx.prisma.user.create({
      data: { email: 'stranger@stu.ui.edu.ng', passwordHash: DEV_HASH, displayName: 'Stranger' },
    });
    const pendingIn = await ctx.prisma.user.create({
      data: {
        email: 'pending.in@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Pending In',
      },
    });
    const pendingOut = await ctx.prisma.user.create({
      data: {
        email: 'pending.out@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Pending Out',
      },
    });
    const blockedA = await ctx.prisma.user.create({
      data: { email: 'blocked.a@stu.ui.edu.ng', passwordHash: DEV_HASH, displayName: 'Blocked A' },
    });
    const blockedB = await ctx.prisma.user.create({
      data: { email: 'blocked.b@stu.ui.edu.ng', passwordHash: DEV_HASH, displayName: 'Blocked B' },
    });
    const stealthAccount = await ctx.prisma.user.create({
      data: {
        email: 'stealth.acct@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Stealth Account',
        rsvpVisibility: 'PRIVATE',
      },
    });
    const hiddenAccount = await ctx.prisma.user.create({
      data: {
        email: 'hidden.acct@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Hidden Account',
        hideFromFriends: true,
      },
    });
    const stealthRsvpUser = await ctx.prisma.user.create({
      data: {
        email: 'stealth.rsvp@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Stealth RSVP',
      },
    });

    await ctx.prisma.friendship.createMany({
      data: [
        { requesterId: pendingIn.id, addresseeId: viewer.id, status: 'PENDING' },
        { requesterId: viewer.id, addresseeId: pendingOut.id, status: 'PENDING' },
        { requesterId: viewer.id, addresseeId: blockedA.id, status: 'BLOCKED' },
        { requesterId: blockedB.id, addresseeId: viewer.id, status: 'BLOCKED' },
        { requesterId: viewer.id, addresseeId: stealthAccount.id, status: 'ACCEPTED' },
        { requesterId: viewer.id, addresseeId: hiddenAccount.id, status: 'ACCEPTED' },
        { requesterId: viewer.id, addresseeId: stealthRsvpUser.id, status: 'ACCEPTED' },
      ],
    });

    for (const u of [
      stranger,
      pendingIn,
      pendingOut,
      blockedA,
      blockedB,
      stealthAccount,
      hiddenAccount,
      stealthRsvpUser,
    ]) {
      await ctx.prisma.rsvp.create({
        data: {
          eventId: event.id,
          userId: u.id,
          status: 'CONFIRMED',
          hideFromFriends: u.id === stealthRsvpUser.id,
          qrToken: `tok-${randomUUID()}`,
        },
      });
    }

    // Anonymous feed sees zero friendsGoing
    const anonFeed = bodyOf<FeedResponse>(await anon(ctx.app).get('/events/feed').expect(200));
    expect(anonFeed.items[0]?.friendsGoing).toEqual([]);
    expect(anonFeed.items[0]?.friendsGoingCount).toBe(0);

    // Authenticated viewer sees max 3 mutual avatars and friendsGoingCount === 4 on both feed and detail
    const authFeed = bodyOf<FeedResponse>(
      await asUser(ctx.app, viewer.email).get('/events/feed').expect(200),
    );
    const feedItem = authFeed.items.find((e) => e.id === event.id)!;
    expect(feedItem.friendsGoing).toHaveLength(3);
    expect(feedItem.friendsGoingCount).toBe(4);
    const mutualIdSet = new Set(mutuals.map((m) => m.id));
    for (const fg of feedItem.friendsGoing ?? []) {
      expect(mutualIdSet.has(fg.id)).toBe(true);
    }

    const detail = bodyOf<EventPublic>(
      await asUser(ctx.app, viewer.email).get(`/events/${event.slug}`).expect(200),
    );
    expect(detail.friendsGoing).toHaveLength(3);
    expect(detail.friendsGoingCount).toBe(4);
  });

  it('supports feed mood (next 6h) & search filters, /search, PUT /users/me/persona, and /events/for-you', async () => {
    const owner1 = await ctx.prisma.user.create({
      data: {
        email: 'owner1@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Owner 1',
        role: 'ORGANIZER',
      },
    });
    const owner2 = await ctx.prisma.user.create({
      data: {
        email: 'owner2@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Owner 2',
        role: 'ORGANIZER',
      },
    });
    const owner3 = await ctx.prisma.user.create({
      data: {
        email: 'owner3@stu.ui.edu.ng',
        passwordHash: DEV_HASH,
        displayName: 'Owner 3',
        role: 'ORGANIZER',
      },
    });

    const verifiedClub = await ctx.prisma.organizer.create({
      data: {
        ownerId: owner1.id,
        slug: 'sigma-club-ui',
        name: 'Sigma Club UI',
        bio: 'Social & philanthropic club',
        isVerified: true,
      },
    });
    const unverifiedClub = await ctx.prisma.organizer.create({
      data: {
        ownerId: owner2.id,
        slug: 'sigma-shadow',
        name: 'Sigma Shadow Unverified',
        isVerified: false,
      },
    });
    const otherClub = await ctx.prisma.organizer.create({
      data: {
        ownerId: owner3.id,
        slug: 'debate-ui',
        name: 'UI Literary & Debating',
        isVerified: true,
      },
    });

    const now = Date.now();
    const soonTurnUp = await ctx.prisma.event.create({
      data: {
        slug: 'tonight-turnup',
        organizerId: verifiedClub.id,
        title: 'Havana Rooftop Turn Up',
        description: 'Afrobeats and amapiano all night.',
        category: 'SOCIAL_PARTY',
        tonightMood: 'TURN_UP',
        status: 'PUBLISHED',
        startsAt: new Date(now + 2 * 3600_000),
        endsAt: new Date(now + 5 * 3600_000),
        venueName: 'SUB Field',
        coverImageUrl: 'https://cdn.campuspulse.ng/covers/turnup.webp',
      },
    });
    const tomorrowTurnUp = await ctx.prisma.event.create({
      data: {
        slug: 'tomorrow-turnup',
        organizerId: verifiedClub.id,
        title: 'Tomorrow Night Party',
        description: 'Too far out for next-6h tonight mood filter.',
        category: 'SOCIAL_PARTY',
        tonightMood: 'TURN_UP',
        status: 'PUBLISHED',
        startsAt: new Date(now + 20 * 3600_000),
        endsAt: new Date(now + 24 * 3600_000),
        venueName: 'Trenchard Hall',
        coverImageUrl: 'https://cdn.campuspulse.ng/covers/tomorrow.webp',
      },
    });
    await ctx.prisma.event.create({
      data: {
        slug: 'debate-colloquium',
        organizerId: otherClub.id,
        title: 'Inter-Hall Debate Colloquium',
        description: 'Public speaking finals.',
        category: 'ACADEMIC_CONFERENCE',
        tonightMood: 'LEARN',
        status: 'PUBLISHED',
        startsAt: new Date(now + 1 * 3600_000),
        endsAt: new Date(now + 3 * 3600_000),
        venueName: 'Faculty of Arts Large Lecture Theatre',
        coverImageUrl: 'https://cdn.campuspulse.ng/covers/debate.webp',
      },
    });

    // 1. Mood filter returns only TURN_UP within next 6h
    const moodFeed = bodyOf<FeedResponse>(
      await anon(ctx.app).get('/events/feed?mood=TURN_UP').expect(200),
    );
    expect(moodFeed.items.map((e) => e.id)).toEqual([soonTurnUp.id]);

    // 2. Feed text search matches venueName / organizer name
    const searchFeed = bodyOf<FeedResponse>(
      await anon(ctx.app).get('/events/feed?search=Trenchard').expect(200),
    );
    expect(searchFeed.items.map((e) => e.id)).toEqual([tomorrowTurnUp.id]);

    // 3. GET /search?q=Sigma returns matching published events + ONLY verified clubs
    const campusSearch = bodyOf<AttendeeSearchResponse>(
      await anon(ctx.app).get('/search?q=Sigma').expect(200),
    );
    expect(campusSearch.organizers.map((o) => o.id)).toEqual([verifiedClub.id]);
    expect(campusSearch.organizers.some((o) => o.id === unverifiedClub.id)).toBe(false);
    expect(campusSearch.events.length).toBe(2);

    // 4. PUT /users/me/persona saves cohort, vibes, and follows verifiedClub, boosting /events/for-you
    const personaPayload: AttendeePersona = {
      skipped: false,
      vibes: ['SOCIAL_PARTY', 'Afrobeats'],
      hall: 'Mellanby Hall',
      faculty: 'Technology',
      level: '300L',
      rhythm: 'BOTH',
      freeEventsOnly: true,
      personaBadge: 'Nightlife Navigator',
      followedClubIds: [verifiedClub.id],
    };

    const personaRes = await asUser(ctx.app, 'explorer@stu.ui.edu.ng')
      .put('/users/me/persona')
      .send(personaPayload)
      .expect(200);
    expect(bodyOf<AttendeePersona>(personaRes)).toMatchObject({
      hall: 'Mellanby Hall',
      faculty: 'Technology',
      level: '300L',
      personaBadge: 'Nightlife Navigator',
      followedClubIds: [verifiedClub.id],
    });

    const prefsRes = await asUser(ctx.app, 'explorer@stu.ui.edu.ng')
      .get('/users/me/preferences')
      .expect(200);
    expect(bodyOf<AttendeePreferences>(prefsRes).persona?.followedClubIds).toEqual([
      verifiedClub.id,
    ]);

    // 5. GET /events/for-you ranks followed-club + matching-vibe event #1 ahead of earlier unrelated debate
    const forYouRes = await asUser(ctx.app, 'explorer@stu.ui.edu.ng')
      .get('/events/for-you')
      .expect(200);
    const forYou = bodyOf<FeedResponse>(forYouRes);
    expect(forYou.items[0]?.id).toBe(soonTurnUp.id);
  });
});
