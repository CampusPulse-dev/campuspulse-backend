import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import {
  DOMAIN_EVENTS,
  type EventCancelledPayload,
  type EventUpdatedPayload,
} from '../../common/domain-events';
import {
  EVENT_PUBLIC_INCLUDE,
  toEventPublic,
  toOrganizerPublic,
} from '../../common/mappers/entity.mappers';
import { PrismaService } from '../../common/prisma.service';
import type {
  AttendeeSearchResponse,
  CancelEventBody,
  CreateEventBody,
  EventPublic,
  FeedQuery,
  FeedResponse,
  ForYouQuery,
  SearchQuery,
  UpdateEventBody,
  UpdateFixtureBody,
} from '../../contract';
import { FriendsGoingService } from '../identity/friends-going.service';
import { OrganizerAccessService } from '../identity/organizer-access.service';

const MOOD_WINDOW_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizerAccess: OrganizerAccessService,
    private readonly friendsGoing: FriendsGoingService,
    private readonly eventsEmitter: EventEmitter2,
  ) {}

  /**
   * Feed: published events only, soonest first, cursor-paginated.
   * Supports category, start time (`from`), tonight `mood` (next 6h), and text `search`,
   * plus mutual `friendsGoing` enrichment when signed in.
   */
  async feed(query: FeedQuery, viewerId?: string): Promise<FeedResponse> {
    const { limit, cursor, category, from, mood, search } = query;
    const now = new Date();
    const sixHoursOut = new Date(now.getTime() + MOOD_WINDOW_MS);

    let startsAtFilter: Prisma.DateTimeFilter | undefined;
    if (mood) {
      const lowerBound = from && new Date(from) > now ? new Date(from) : now;
      startsAtFilter = { gte: lowerBound, lte: sixHoursOut };
    } else if (from) {
      startsAtFilter = { gte: new Date(from) };
    }

    const where: Prisma.EventWhereInput = {
      status: 'PUBLISHED',
      ...(category ? { category } : {}),
      ...(mood ? { tonightMood: mood } : {}),
      ...(startsAtFilter ? { startsAt: startsAtFilter } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { venueName: { contains: search, mode: 'insensitive' } },
              { organizer: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const events = await this.prisma.event.findMany({
      where,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: EVENT_PUBLIC_INCLUDE,
    });

    const hasMore = events.length > limit;
    const slice = hasMore ? events.slice(0, limit) : events;
    const items = await this.friendsGoing.enrichEvents(viewerId, slice);

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * Personalized "For You" recommendations scored from followed clubs/creators,
   * mutual friends going, past check-ins, and onboarding persona tags.
   */
  async forYou(userId: string, query: ForYouQuery): Promise<FeedResponse> {
    const now = new Date();

    const [candidates, follows, creatorFollows, checkIns, persona] = await Promise.all([
      this.prisma.event.findMany({
        where: {
          status: 'PUBLISHED',
          endsAt: { gte: now },
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: 60,
        include: EVENT_PUBLIC_INCLUDE,
      }),
      this.prisma.follow.findMany({
        where: { userId },
        select: { organizerId: true },
      }),
      this.prisma.creatorFollow.findMany({
        where: { userId },
        select: { creatorId: true },
      }),
      this.prisma.checkIn.findMany({
        where: { rsvp: { userId } },
        select: {
          event: {
            select: { category: true, organizerId: true },
          },
        },
        take: 50,
      }),
      this.prisma.personaProfile.findUnique({
        where: { userId },
      }),
    ]);

    if (candidates.length === 0) {
      return { items: [], nextCursor: null };
    }

    const extrasMap = await this.friendsGoing.getExtrasForEvents(
      userId,
      candidates.map((c) => c.id),
    );

    const followedClubIds = new Set(follows.map((f) => f.organizerId));
    const followedCreatorIds = new Set(creatorFollows.map((f) => f.creatorId));
    const pastCategories = new Set(checkIns.map((c) => c.event.category));
    const pastOrganizers = new Set(checkIns.map((c) => c.event.organizerId));
    const personaTags = (persona?.interestTags ?? []).map((t) => t.toLowerCase());
    const rhythm = persona?.goingOutRhythm ?? 'BOTH';

    const scored = candidates.map((event) => {
      const extras = extrasMap.get(event.id);
      const friendsCount = extras?.friendsGoingCount ?? 0;
      let score = 0;

      if (followedClubIds.has(event.organizerId)) {
        score += 40;
      }
      if (
        event.lineupItems.some(
          (item) => item.creatorId !== null && followedCreatorIds.has(item.creatorId),
        )
      ) {
        score += 25;
      }

      score += Math.min(friendsCount, 4) * 15;

      if (pastCategories.has(event.category)) {
        score += 15;
      }
      if (pastOrganizers.has(event.organizerId)) {
        score += 10;
      }

      if (personaTags.length > 0) {
        const haystack =
          `${event.category} ${event.tonightMood ?? ''} ${event.title} ${event.description}`.toLowerCase();
        for (const tag of personaTags) {
          if (haystack.includes(tag)) {
            score += 20;
          }
        }
      }

      const day = event.startsAt.getUTCDay();
      const isWeekend = day === 0 || day === 5 || day === 6;
      if (
        rhythm === 'BOTH' ||
        (rhythm === 'WEEKENDS' && isWeekend) ||
        (rhythm === 'WEEKNIGHTS' && !isWeekend)
      ) {
        score += 10;
      }

      return {
        event,
        extras,
        score,
      };
    });

    scored.sort(
      (a, b) =>
        b.score - a.score ||
        a.event.startsAt.getTime() - b.event.startsAt.getTime() ||
        a.event.id.localeCompare(b.event.id),
    );

    const top = scored.slice(0, query.limit).map((s) => toEventPublic(s.event, s.extras));
    return {
      items: top,
      nextCursor: null,
    };
  }

  async search(query: SearchQuery, viewerId?: string): Promise<AttendeeSearchResponse> {
    const q = query.q.trim();
    if (!q) {
      return { events: [], organizers: [] };
    }

    const [events, organizers] = await Promise.all([
      this.prisma.event.findMany({
        where: {
          status: 'PUBLISHED',
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { venueName: { contains: q, mode: 'insensitive' } },
            { organizer: { name: { contains: q, mode: 'insensitive' } } },
          ],
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: 20,
        include: EVENT_PUBLIC_INCLUDE,
      }),
      this.prisma.organizer.findMany({
        where: {
          isVerified: true,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
            { bio: { contains: q, mode: 'insensitive' } },
          ],
        },
        orderBy: [{ followerCount: 'desc' }, { name: 'asc' }],
        take: 20,
      }),
    ]);

    const enrichedEvents = await this.friendsGoing.enrichEvents(viewerId, events);

    return {
      events: enrichedEvents,
      organizers: organizers.map((o) => toOrganizerPublic(o)),
    };
  }

  async findBySlug(slug: string, viewerId?: string): Promise<EventPublic> {
    const event = await this.prisma.event.findUnique({
      where: { slug },
      include: EVENT_PUBLIC_INCLUDE,
    });
    if (!event) {
      throw new NotFoundException(`No event with slug "${slug}"`);
    }

    if (event.status === 'DRAFT') {
      const canPreview =
        viewerId !== undefined &&
        (await this.organizerAccess.isMember(viewerId, event.organizerId));
      if (!canPreview) {
        throw new NotFoundException(`No event with slug "${slug}"`);
      }
    }

    const [enriched] = await this.friendsGoing.enrichEvents(viewerId, [event]);
    return enriched!;
  }

  async create(userId: string, body: CreateEventBody): Promise<EventPublic> {
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }

    const organizerId = await this.organizerAccess.resolveOrganizerForUser(
      userId,
      body.organizerId,
    );

    let parentLinkApproved = true;
    if (body.parentEventId) {
      const parentEvent = await this.prisma.event.findUnique({
        where: { id: body.parentEventId },
        select: { id: true, organizerId: true },
      });
      if (!parentEvent) {
        throw new NotFoundException('Parent event not found');
      }
      parentLinkApproved = parentEvent.organizerId === organizerId;
    }

    const slug = await this.generateUniqueSlug(body.title);
    const lineupCreates = this.buildLineupCreates(body.lineup, body.castAndCrew);

    const created = await this.prisma.event.create({
      data: {
        slug,
        organizerId,
        title: body.title,
        description: body.description,
        category: body.category,
        status: 'DRAFT',
        template: body.template ?? 'GENERIC',
        tonightMood: body.tonightMood ?? null,
        startsAt,
        endsAt,
        venueName: body.venueName,
        venueDetail: body.venueDetail,
        coverImageUrl: body.coverImageUrl,
        capacity: body.capacity,
        studentsOnly: body.studentsOnly ?? false,
        waitlistEnabled: body.waitlistEnabled ?? true,
        dressCode: body.dressCode ?? null,
        doorPolicy: body.doorPolicy ?? null,
        whatsappGroupUrl: body.whatsappGroupUrl ?? null,
        parentEventId: body.parentEventId ?? null,
        linkType: body.linkType ?? (body.parentEventId ? 'AFTER_PARTY' : null),
        parentLinkApproved,
        afterPartyAccess: body.afterPartyAccess ?? 'OPEN',
        ...(body.showtimes && body.showtimes.length > 0
          ? {
              showtimes: {
                create: body.showtimes.map((st) => ({
                  label: st.label.trim(),
                  startsAt: new Date(st.startsAt),
                  endsAt: st.endsAt ? new Date(st.endsAt) : null,
                  capacity: st.capacity ?? null,
                })),
              },
            }
          : {}),
        ...(lineupCreates.length > 0
          ? {
              lineupItems: {
                create: lineupCreates,
              },
            }
          : {}),
        ...(body.fixture
          ? {
              fixture: {
                create: {
                  homeTeamName: body.fixture.homeTeam,
                  awayTeamName: body.fixture.awayTeam,
                  homeScore: body.fixture.homeScore,
                  awayScore: body.fixture.awayScore,
                  isLive: body.fixture.isLive,
                  statusLabel: body.fixture.periodLabel,
                },
              },
            }
          : {}),
      },
      include: EVENT_PUBLIC_INCLUDE,
    });

    return toEventPublic(created);
  }

  async update(userId: string, eventId: string, body: UpdateEventBody): Promise<EventPublic> {
    const existing = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { lineupItems: true },
    });
    if (!existing) {
      throw new NotFoundException('Event not found');
    }

    await this.organizerAccess.assertRole(userId, existing.organizerId, ['OWNER', 'MANAGER']);

    const nextStartsAt = body.startsAt ? new Date(body.startsAt) : existing.startsAt;
    const nextEndsAt = body.endsAt ? new Date(body.endsAt) : existing.endsAt;
    if (nextEndsAt <= nextStartsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (body.showtimes !== undefined) {
        await tx.eventShowtime.deleteMany({ where: { eventId } });
        if (body.showtimes.length > 0) {
          await tx.eventShowtime.createMany({
            data: body.showtimes.map((st) => ({
              eventId,
              label: st.label.trim(),
              startsAt: new Date(st.startsAt),
              endsAt: st.endsAt ? new Date(st.endsAt) : null,
              capacity: st.capacity ?? null,
            })),
          });
        }
      }

      if (body.lineup !== undefined || body.castAndCrew !== undefined) {
        const nextLineup =
          body.lineup ??
          existing.lineupItems
            .filter((i) => i.roleType !== 'CAST_CREW')
            .map((i) => ({
              performerName: i.displayName,
              role: i.roleLabel,
              setTime: i.setTime ?? '',
              creatorId: i.creatorId,
            }));
        const nextCast =
          body.castAndCrew ??
          existing.lineupItems.filter((i) => i.roleType === 'CAST_CREW').map((i) => i.displayName);

        await tx.eventLineupItem.deleteMany({ where: { eventId } });
        const lineupCreates = this.buildLineupCreates(nextLineup, nextCast);
        if (lineupCreates.length > 0) {
          await tx.eventLineupItem.createMany({
            data: lineupCreates.map((item) => ({ ...item, eventId })),
          });
        }
      }

      if (body.fixture !== undefined) {
        await tx.eventFixture.upsert({
          where: { eventId },
          create: {
            eventId,
            homeTeamName: body.fixture.homeTeam,
            awayTeamName: body.fixture.awayTeam,
            homeScore: body.fixture.homeScore,
            awayScore: body.fixture.awayScore,
            isLive: body.fixture.isLive,
            statusLabel: body.fixture.periodLabel,
          },
          update: {
            homeTeamName: body.fixture.homeTeam,
            awayTeamName: body.fixture.awayTeam,
            homeScore: body.fixture.homeScore,
            awayScore: body.fixture.awayScore,
            isLive: body.fixture.isLive,
            statusLabel: body.fixture.periodLabel,
          },
        });
      }

      return tx.event.update({
        where: { id: eventId },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(body.template !== undefined ? { template: body.template } : {}),
          ...(body.tonightMood !== undefined ? { tonightMood: body.tonightMood } : {}),
          ...(body.startsAt !== undefined ? { startsAt: nextStartsAt } : {}),
          ...(body.endsAt !== undefined ? { endsAt: nextEndsAt } : {}),
          ...(body.venueName !== undefined ? { venueName: body.venueName } : {}),
          ...(body.venueDetail !== undefined ? { venueDetail: body.venueDetail } : {}),
          ...(body.coverImageUrl !== undefined ? { coverImageUrl: body.coverImageUrl } : {}),
          ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
          ...(body.studentsOnly !== undefined ? { studentsOnly: body.studentsOnly } : {}),
          ...(body.waitlistEnabled !== undefined ? { waitlistEnabled: body.waitlistEnabled } : {}),
          ...(body.dressCode !== undefined ? { dressCode: body.dressCode } : {}),
          ...(body.doorPolicy !== undefined ? { doorPolicy: body.doorPolicy } : {}),
          ...(body.whatsappGroupUrl !== undefined
            ? { whatsappGroupUrl: body.whatsappGroupUrl }
            : {}),
          ...(body.afterPartyAccess !== undefined
            ? { afterPartyAccess: body.afterPartyAccess }
            : {}),
        },
        include: EVENT_PUBLIC_INCLUDE,
      });
    });

    const payload: EventUpdatedPayload = {
      eventId: updated.id,
      slug: updated.slug,
      title: updated.title,
      previousStartsAt: existing.startsAt.toISOString(),
      startsAt: updated.startsAt.toISOString(),
      endsAt: updated.endsAt.toISOString(),
      venueName: updated.venueName,
    };
    this.eventsEmitter.emit(DOMAIN_EVENTS.EVENT_UPDATED, payload);

    return toEventPublic(updated);
  }

  async publish(userId: string, eventId: string): Promise<EventPublic> {
    const existing = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { organizer: true },
    });
    if (!existing) {
      throw new NotFoundException('Event not found');
    }

    await this.organizerAccess.assertRole(userId, existing.organizerId, ['OWNER', 'MANAGER']);

    if (!existing.organizer.isVerified) {
      throw new ForbiddenException('Organizer must be verified before publishing events');
    }
    if (existing.status === 'CANCELLED') {
      throw new BadRequestException('Cancelled events cannot be published');
    }

    const published = await this.prisma.event.update({
      where: { id: eventId },
      data: { status: 'PUBLISHED' },
      include: EVENT_PUBLIC_INCLUDE,
    });

    return toEventPublic(published);
  }

  async cancel(userId: string, eventId: string, body: CancelEventBody): Promise<EventPublic> {
    const existing = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!existing) {
      throw new NotFoundException('Event not found');
    }

    await this.organizerAccess.assertRole(userId, existing.organizerId, ['OWNER', 'MANAGER']);

    const cancelled = await this.prisma.event.update({
      where: { id: eventId },
      data: {
        status: 'CANCELLED',
        cancelReason: body.reason,
      },
      include: EVENT_PUBLIC_INCLUDE,
    });

    const payload: EventCancelledPayload = {
      eventId: cancelled.id,
      slug: cancelled.slug,
      title: cancelled.title,
      reason: body.reason,
    };
    this.eventsEmitter.emit(DOMAIN_EVENTS.EVENT_CANCELLED, payload);

    return toEventPublic(cancelled);
  }

  async updateFixture(
    userId: string,
    eventId: string,
    body: UpdateFixtureBody,
  ): Promise<EventPublic> {
    const existing = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { fixture: true },
    });
    if (!existing) {
      throw new NotFoundException('Event not found');
    }

    await this.organizerAccess.assertRole(userId, existing.organizerId, ['OWNER', 'MANAGER']);

    if (!existing.fixture) {
      throw new BadRequestException('Event does not have a match fixture block');
    }

    await this.prisma.eventFixture.update({
      where: { eventId },
      data: {
        homeScore: body.homeScore,
        awayScore: body.awayScore,
        isLive: body.isLive,
        statusLabel: body.periodLabel,
      },
    });

    const reloaded = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      include: EVENT_PUBLIC_INCLUDE,
    });
    return toEventPublic(reloaded);
  }

  async approveLink(userId: string, eventId: string): Promise<EventPublic> {
    const child = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { parentEvent: true },
    });
    if (!child) {
      throw new NotFoundException('Event not found');
    }
    if (!child.parentEventId || !child.parentEvent) {
      throw new BadRequestException('Event has no parent event link to approve');
    }

    await this.organizerAccess.assertRole(userId, child.parentEvent.organizerId, ['OWNER']);

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: { parentLinkApproved: true },
      include: EVENT_PUBLIC_INCLUDE,
    });

    return toEventPublic(updated);
  }

  private buildLineupCreates(
    lineup?: CreateEventBody['lineup'],
    castAndCrew?: CreateEventBody['castAndCrew'],
  ) {
    const items: Array<{
      roleType: string;
      displayName: string;
      roleLabel: string;
      setTime: string | null;
      sortOrder: number;
      creatorId: string | null;
    }> = [];

    let sortOrder = 0;
    for (const entry of lineup ?? []) {
      items.push({
        roleType: 'LINEUP',
        displayName: entry.performerName,
        roleLabel: entry.role,
        setTime: entry.setTime || null,
        sortOrder: sortOrder++,
        creatorId: entry.creatorId ?? null,
      });
    }

    for (const credit of castAndCrew ?? []) {
      items.push({
        roleType: 'CAST_CREW',
        displayName: credit,
        roleLabel: 'Cast & Crew',
        setTime: null,
        sortOrder: sortOrder++,
        creatorId: null,
      });
    }

    return items;
  }

  private async generateUniqueSlug(title: string): Promise<string> {
    const base =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 68)
        .replace(/-+$/g, '') || 'campus-event';

    const existing = await this.prisma.event.findUnique({
      where: { slug: base },
      select: { id: true },
    });
    if (!existing) {
      return base;
    }

    const suffix = randomBytes(3).toString('hex');
    return `${base}-${suffix}`;
  }
}
