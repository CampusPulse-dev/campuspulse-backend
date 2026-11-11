import { Injectable, NotFoundException } from '@nestjs/common';
import { EVENT_PUBLIC_INCLUDE, toEventPublic } from '../../common/mappers/entity.mappers';
import { PrismaService } from '../../common/prisma.service';
import type {
  ManagedEvent,
  ManagedEventsQuery,
  ManagedEventsResponse,
  OrganizerDashboardResponse,
} from '../../contract';
import { OrganizerAccessService } from '../identity/organizer-access.service';
import { OrganizerTeamService } from '../identity/organizer-team.service';

@Injectable()
export class ManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizerAccessService,
    private readonly team: OrganizerTeamService,
  ) {}

  async dashboard(userId: string, organizerId: string): Promise<OrganizerDashboardResponse> {
    await this.access.assertRole(userId, organizerId, ['OWNER', 'MANAGER']);
    const membership = (await this.team.listMine(userId)).items.find(
      (m) => m.organizer.id === organizerId,
    );
    if (!membership) throw new NotFoundException('Club not found');
    const now = new Date();
    const [upcoming, past, activeStories] = await Promise.all([
      this.prisma.event.aggregate({
        where: { organizerId, status: 'PUBLISHED', endsAt: { gte: now } },
        _sum: { rsvpCount: true },
      }),
      this.prisma.event.aggregate({
        where: { organizerId, status: { in: ['PUBLISHED', 'COMPLETED'] }, endsAt: { lt: now } },
        _sum: { rsvpCount: true, checkInCount: true },
      }),
      this.prisma.story.count({ where: { organizerId, expiresAt: { gt: now } } }),
    ]);
    const total = past._sum.rsvpCount ?? 0;
    return {
      membership,
      kpis: {
        followers: membership.organizer.followerCount,
        upcomingRsvps: upcoming._sum.rsvpCount ?? 0,
        showUpRate: total ? Math.min(1, (past._sum.checkInCount ?? 0) / total) : null,
        activeStories,
      },
    };
  }

  async listEvents(
    userId: string,
    organizerId: string,
    query: ManagedEventsQuery,
  ): Promise<ManagedEventsResponse> {
    await this.access.assertRole(userId, organizerId, ['OWNER', 'MANAGER']);
    const rows = await this.prisma.event.findMany({
      where: { organizerId, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      include: EVENT_PUBLIC_INCLUDE,
    });
    const items = rows
      .slice(0, query.limit)
      .map((row) => ({ ...toEventPublic(row), checkInCount: row.checkInCount }));
    return { items, nextCursor: rows.length > query.limit ? items[items.length - 1]!.id : null };
  }

  async event(userId: string, eventId: string): Promise<ManagedEvent> {
    const row = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: EVENT_PUBLIC_INCLUDE,
    });
    if (!row) throw new NotFoundException('Event not found');
    await this.access.assertRole(userId, row.organizerId, ['OWNER', 'MANAGER']);
    const event = toEventPublic(row);
    return {
      ...event,
      checkInCount: row.checkInCount,
      parentLinkApproved: row.parentLinkApproved,
      draft: {
        organizerId: row.organizerId,
        title: row.title,
        description: row.description,
        category: row.category,
        template: event.template,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        venueName: row.venueName,
        venueDetail: row.venueDetail,
        coverImageUrl: row.coverImageUrl,
        capacity: row.capacity,
        studentsOnly: row.studentsOnly,
        waitlistEnabled: row.waitlistEnabled,
        dressCode: row.dressCode,
        doorPolicy: row.doorPolicy,
        parentEventId: row.parentEventId,
        linkType: row.linkType,
        afterPartyAccess: row.afterPartyAccess,
        tonightMood: row.tonightMood,
        lineup: row.lineupItems
          .filter((x) => x.roleType !== 'CAST_CREW')
          .map((x) => ({
            performerName: x.displayName,
            role: x.roleLabel,
            setTime: x.setTime ?? '',
            creatorId: x.creatorId,
          })),
        castAndCrew: row.lineupItems
          .filter((x) => x.roleType === 'CAST_CREW')
          .map((x) => x.displayName),
        showtimes: row.showtimes.map((x) => ({
          label: x.label,
          startsAt: x.startsAt.toISOString(),
          endsAt: x.endsAt?.toISOString() ?? null,
          capacity: x.capacity,
        })),
        ...(event.fixture ? { fixture: event.fixture } : {}),
      },
    };
  }
}
