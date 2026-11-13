import { Injectable } from '@nestjs/common';
import {
  toEventPublic,
  type EventMapperExtras,
  type EventWithPublicRelations,
} from '../../common/mappers/entity.mappers';
import { PrismaService } from '../../common/prisma.service';
import type { EventPublic, UserPublic } from '../../contract';

const MAX_FRIENDS_AVATARS = 3;

@Injectable()
export class FriendsGoingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Computes mutual `friendsGoing` (capped at 3 avatars) and `friendsGoingCount`
   * per event for `viewerId`, strictly honoring:
   * - mutual `ACCEPTED` friendships only (strangers & `PENDING` excluded)
   * - bidirectional `BLOCKED` exclusions
   * - `User.rsvpVisibility !== 'PRIVATE'`
   * - `User.hideFromFriends === false`
   * - `Rsvp.hideFromFriends === false` and `Rsvp.status === 'CONFIRMED'`
   */
  async getExtrasForEvents(
    viewerId: string | undefined,
    eventIds: string[],
  ): Promise<Map<string, EventMapperExtras>> {
    const result = new Map<string, EventMapperExtras>();
    if (!viewerId || eventIds.length === 0) {
      return result;
    }

    const friendships = await this.prisma.friendship.findMany({
      where: {
        OR: [{ requesterId: viewerId }, { addresseeId: viewerId }],
      },
      select: {
        requesterId: true,
        addresseeId: true,
        status: true,
      },
    });

    const blockedIds = new Set<string>();
    const acceptedIds = new Set<string>();

    for (const row of friendships) {
      const otherId = row.requesterId === viewerId ? row.addresseeId : row.requesterId;
      if (row.status === 'BLOCKED') {
        blockedIds.add(otherId);
      } else if (row.status === 'ACCEPTED') {
        acceptedIds.add(otherId);
      }
    }

    for (const blockedId of blockedIds) {
      acceptedIds.delete(blockedId);
    }

    if (acceptedIds.size === 0) {
      return result;
    }

    const rsvps = await this.prisma.rsvp.findMany({
      where: {
        eventId: { in: eventIds },
        userId: { in: [...acceptedIds] },
        status: 'CONFIRMED',
        hideFromFriends: false,
        user: {
          rsvpVisibility: { not: 'PRIVATE' },
          hideFromFriends: false,
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        eventId: true,
        userId: true,
        user: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    const seenPerEvent = new Map<string, Set<string>>();
    const avatarsPerEvent = new Map<
      string,
      Array<Pick<UserPublic, 'id' | 'displayName' | 'avatarUrl'>>
    >();

    for (const rsvp of rsvps) {
      let seen = seenPerEvent.get(rsvp.eventId);
      if (!seen) {
        seen = new Set<string>();
        seenPerEvent.set(rsvp.eventId, seen);
      }
      if (seen.has(rsvp.userId)) {
        continue;
      }
      seen.add(rsvp.userId);

      let avatars = avatarsPerEvent.get(rsvp.eventId);
      if (!avatars) {
        avatars = [];
        avatarsPerEvent.set(rsvp.eventId, avatars);
      }
      if (avatars.length < MAX_FRIENDS_AVATARS) {
        avatars.push({
          id: rsvp.user.id,
          displayName: rsvp.user.displayName,
          avatarUrl: rsvp.user.avatarUrl,
        });
      }
    }

    for (const [eventId, seen] of seenPerEvent.entries()) {
      result.set(eventId, {
        friendsGoing: avatarsPerEvent.get(eventId) ?? [],
        friendsGoingCount: seen.size,
      });
    }

    return result;
  }

  async enrichEvents(
    viewerId: string | undefined,
    events: EventWithPublicRelations[],
  ): Promise<EventPublic[]> {
    const extras = await this.getExtrasForEvents(
      viewerId,
      events.map((e) => e.id),
    );
    return events.map((e) => toEventPublic(e, extras.get(e.id)));
  }
}
