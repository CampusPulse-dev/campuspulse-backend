import type { PrismaService } from '../../common/prisma.service';
import { FriendsGoingService } from './friends-going.service';

describe('FriendsGoingService', () => {
  const viewerId = '00000000-0000-4000-8000-000000000001';
  const eventId = '22222222-2222-4222-8222-222222222201';

  function makePrisma(overrides: {
    friendships?: Array<{
      requesterId: string;
      addresseeId: string;
      status: 'PENDING' | 'ACCEPTED' | 'BLOCKED';
    }>;
    rsvps?: Array<{
      eventId: string;
      userId: string;
      status: 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED';
      hideFromFriends: boolean;
      user: {
        id: string;
        displayName: string;
        avatarUrl: string | null;
        rsvpVisibility: 'FRIENDS' | 'PRIVATE';
        hideFromFriends: boolean;
      };
    }>;
  }) {
    const findFriendships = jest.fn().mockResolvedValue(overrides.friendships ?? []);
    const findRsvps = jest.fn().mockImplementation(
      ({
        where,
      }: {
        where: {
          eventId: { in: string[] };
          userId: { in: string[] };
          status: string;
          hideFromFriends: boolean;
          user: { rsvpVisibility: { not: string }; hideFromFriends: boolean };
        };
      }) => {
        const allowedUsers = new Set(where.userId.in);
        const allowedEvents = new Set(where.eventId.in);
        return Promise.resolve(
          (overrides.rsvps ?? []).filter(
            (r) =>
              allowedEvents.has(r.eventId) &&
              allowedUsers.has(r.userId) &&
              r.status === where.status &&
              r.hideFromFriends === where.hideFromFriends &&
              r.user.rsvpVisibility !== where.user.rsvpVisibility.not &&
              r.user.hideFromFriends === where.user.hideFromFriends,
          ),
        );
      },
    );

    return {
      prisma: {
        friendship: { findMany: findFriendships },
        rsvp: { findMany: findRsvps },
      } as unknown as PrismaService,
      findFriendships,
      findRsvps,
    };
  }

  it('skips DB queries when viewerId is undefined or eventIds is empty', async () => {
    const { prisma, findFriendships } = makePrisma({});
    const service = new FriendsGoingService(prisma);

    const anonMap = await service.getExtrasForEvents(undefined, [eventId]);
    const emptyMap = await service.getExtrasForEvents(viewerId, []);

    expect(anonMap.size).toBe(0);
    expect(emptyMap.size).toBe(0);
    expect(findFriendships).not.toHaveBeenCalled();
  });

  it('caps friendsGoing avatars at 3 while reporting full mutual count and deduplicating showtimes', async () => {
    const friendIds = [
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000012',
      '00000000-0000-4000-8000-000000000013',
      '00000000-0000-4000-8000-000000000014',
    ];

    const { prisma } = makePrisma({
      friendships: friendIds.map((id, idx) => ({
        requesterId: idx % 2 === 0 ? viewerId : id,
        addresseeId: idx % 2 === 0 ? id : viewerId,
        status: 'ACCEPTED' as const,
      })),
      rsvps: [
        ...friendIds.map((id, idx) => ({
          eventId,
          userId: id,
          status: 'CONFIRMED' as const,
          hideFromFriends: false,
          user: {
            id,
            displayName: `Friend ${idx + 1}`,
            avatarUrl: null,
            rsvpVisibility: 'FRIENDS' as const,
            hideFromFriends: false,
          },
        })),
        // Duplicate showtime RSVP for Friend 1 on the same event
        {
          eventId,
          userId: friendIds[0]!,
          status: 'CONFIRMED' as const,
          hideFromFriends: false,
          user: {
            id: friendIds[0]!,
            displayName: 'Friend 1',
            avatarUrl: null,
            rsvpVisibility: 'FRIENDS' as const,
            hideFromFriends: false,
          },
        },
      ],
    });

    const service = new FriendsGoingService(prisma);
    const extras = await service.getExtrasForEvents(viewerId, [eventId]);
    const entry = extras.get(eventId);

    expect(entry).toBeDefined();
    expect(entry?.friendsGoing).toHaveLength(3);
    expect(entry?.friendsGoingCount).toBe(4);
  });

  it('excludes pending requests, bidirectional blocks, stealth RSVPs, private accounts, and hidden friends', async () => {
    const pendingIn = '00000000-0000-4000-8000-000000000021';
    const pendingOut = '00000000-0000-4000-8000-000000000022';
    const blockedByViewer = '00000000-0000-4000-8000-000000000023';
    const blockedViewer = '00000000-0000-4000-8000-000000000024';
    const privateVis = '00000000-0000-4000-8000-000000000025';
    const hiddenAccount = '00000000-0000-4000-8000-000000000026';
    const hiddenRsvp = '00000000-0000-4000-8000-000000000027';
    const visibleMutual = '00000000-0000-4000-8000-000000000028';

    const { prisma } = makePrisma({
      friendships: [
        { requesterId: pendingIn, addresseeId: viewerId, status: 'PENDING' },
        { requesterId: viewerId, addresseeId: pendingOut, status: 'PENDING' },
        { requesterId: viewerId, addresseeId: blockedByViewer, status: 'ACCEPTED' },
        { requesterId: viewerId, addresseeId: blockedByViewer, status: 'BLOCKED' },
        { requesterId: blockedViewer, addresseeId: viewerId, status: 'BLOCKED' },
        { requesterId: viewerId, addresseeId: privateVis, status: 'ACCEPTED' },
        { requesterId: viewerId, addresseeId: hiddenAccount, status: 'ACCEPTED' },
        { requesterId: viewerId, addresseeId: hiddenRsvp, status: 'ACCEPTED' },
        { requesterId: viewerId, addresseeId: visibleMutual, status: 'ACCEPTED' },
      ],
      rsvps: [
        pendingIn,
        pendingOut,
        blockedByViewer,
        blockedViewer,
        privateVis,
        hiddenAccount,
        hiddenRsvp,
        visibleMutual,
      ].map((id) => ({
        eventId,
        userId: id,
        status: 'CONFIRMED' as const,
        hideFromFriends: id === hiddenRsvp,
        user: {
          id,
          displayName: `User ${id.slice(-2)}`,
          avatarUrl: null,
          rsvpVisibility: id === privateVis ? ('PRIVATE' as const) : ('FRIENDS' as const),
          hideFromFriends: id === hiddenAccount,
        },
      })),
    });

    const service = new FriendsGoingService(prisma);
    const extras = await service.getExtrasForEvents(viewerId, [eventId]);
    const entry = extras.get(eventId);

    expect(entry?.friendsGoingCount).toBe(1);
    expect(entry?.friendsGoing?.map((u) => u.id)).toEqual([visibleMutual]);
  });
});
