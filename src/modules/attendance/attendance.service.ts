import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { z } from 'zod';
import {
  DOMAIN_EVENTS,
  type InterestLifecyclePayload,
  type RsvpLifecyclePayload,
} from '../../common/domain-events';
import { EVENT_PUBLIC_INCLUDE } from '../../common/mappers/entity.mappers';
import { PrismaService } from '../../common/prisma.service';
import type { Env } from '../../config/env';
import type {
  AmbassadorLinkResponse,
  AttendeeTicketsResponse,
  CancelRsvpResponse,
  CreateAmbassadorLinkBody,
  CreateRsvpBody,
  CreateRsvpResponse,
  InterestedResponse,
  ReportSubmittedResponse,
  Rsvp,
  SubmitReportBody,
  YourNightGroup,
} from '../../contract';
import { FriendsGoingService } from '../identity/friends-going.service';
import { QrTokenService } from './qr-token.service';

interface LockedEventRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  capacity: number | null;
  rsvpCount: number;
  waitlistEnabled: boolean;
  studentsOnly: boolean;
  parentEventId: string | null;
  linkType: string | null;
  afterPartyAccess: string;
}

interface LockedShowtimeRow {
  id: string;
  eventId: string;
  capacity: number | null;
  rsvpCount: number;
}

function toRsvpContract(row: {
  id: string;
  eventId: string;
  userId: string;
  status: Rsvp['status'];
  qrToken: string;
  createdAt: Date;
}): Rsvp {
  return {
    id: row.id,
    eventId: row.eventId,
    userId: row.userId,
    status: row.status,
    qrToken: row.qrToken,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class AttendanceService {
  private readonly webOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly qrTokens: QrTokenService,
    private readonly friendsGoing: FriendsGoingService,
    private readonly eventsEmitter: EventEmitter2,
    config: ConfigService<Env, true>,
  ) {
    this.webOrigin = config.get('WEB_ORIGIN', { infer: true }).replace(/\/+$/, '');
  }

  async createRsvp(userId: string, body: CreateRsvpBody): Promise<CreateRsvpResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isVerifiedStudent: true,
        hideFromFriends: true,
        rsvpVisibility: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (body.showtimeId && !z.uuid().safeParse(body.showtimeId).success) {
      throw new BadRequestException('showtimeId must be a valid UUID');
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      const lockedEvents = await tx.$queryRaw<LockedEventRow[]>`
        SELECT
          id,
          slug,
          title,
          status,
          capacity,
          "rsvpCount",
          "waitlistEnabled",
          "studentsOnly",
          "parentEventId",
          "linkType",
          "afterPartyAccess"
        FROM "Event"
        WHERE id = ${body.eventId}::uuid
        FOR UPDATE
      `;
      const lockedEvent = lockedEvents[0];
      if (!lockedEvent) {
        throw new NotFoundException('Event not found');
      }
      if (lockedEvent.status !== 'PUBLISHED') {
        throw new BadRequestException('Event is not open for RSVPs');
      }
      if (lockedEvent.studentsOnly && !user.isVerifiedStudent) {
        throw new ForbiddenException('Only verified UI students can RSVP to this event');
      }

      if (
        lockedEvent.parentEventId &&
        lockedEvent.linkType === 'AFTER_PARTY' &&
        lockedEvent.afterPartyAccess === 'CHECKED_IN_ONLY'
      ) {
        const parentCheckIn = await tx.checkIn.findFirst({
          where: {
            eventId: lockedEvent.parentEventId,
            rsvp: { userId },
          },
          select: { id: true },
        });
        if (!parentCheckIn) {
          throw new ForbiddenException(
            'Check-in at the parent event is required before reserving this after-party',
          );
        }
      }

      const existing = await tx.rsvp.findUnique({
        where: {
          eventId_userId: {
            eventId: body.eventId,
            userId,
          },
        },
      });
      if (existing && existing.status !== 'CANCELLED') {
        return { rsvp: existing, isNew: false };
      }

      let lockedShowtime: LockedShowtimeRow | undefined;
      if (body.showtimeId) {
        const showtimes = await tx.$queryRaw<LockedShowtimeRow[]>`
          SELECT id, "eventId", capacity, "rsvpCount"
          FROM "EventShowtime"
          WHERE id = ${body.showtimeId}::uuid
            AND "eventId" = ${body.eventId}::uuid
          FOR UPDATE
        `;
        lockedShowtime = showtimes[0];
        if (!lockedShowtime) {
          throw new BadRequestException('Selected showtime does not belong to this event');
        }
      }

      const eventHasSpot =
        lockedEvent.capacity === null || lockedEvent.rsvpCount < lockedEvent.capacity;
      const showtimeHasSpot =
        !lockedShowtime ||
        lockedShowtime.capacity === null ||
        lockedShowtime.rsvpCount < lockedShowtime.capacity;

      let status: 'CONFIRMED' | 'WAITLISTED';
      if (eventHasSpot && showtimeHasSpot) {
        status = 'CONFIRMED';
      } else if (lockedEvent.waitlistEnabled) {
        status = 'WAITLISTED';
      } else {
        throw new ConflictException('Event has reached capacity');
      }

      let ambassadorLinkId: string | null = null;
      if (body.ambassadorCode) {
        const link = await tx.ambassadorLink.findUnique({
          where: { code: body.ambassadorCode },
        });
        if (link && link.eventId === body.eventId) {
          ambassadorLinkId = link.id;
          await tx.ambassadorLink.update({
            where: { id: link.id },
            data: { rsvpCount: { increment: 1 } },
          });
        }
      }

      let inviteId: string | null = null;
      if (body.inviteCode) {
        const invite = await tx.eventInvite.findUnique({
          where: { inviteCode: body.inviteCode },
        });
        if (invite && invite.eventId === body.eventId) {
          inviteId = invite.id;
          await tx.eventInvite.update({
            where: { id: invite.id },
            data: {
              acceptedCount: { increment: 1 },
              ...(invite.acceptedByUserId ? {} : { acceptedByUserId: userId }),
            },
          });
        }
      }

      const rsvpId = existing?.id ?? randomUUID();
      const qrToken = this.qrTokens.sign({
        rsvpId,
        eventId: body.eventId,
        ...(body.showtimeId ? { showtimeId: body.showtimeId } : {}),
        issuedAt: Date.now(),
      });
      const hideFromFriends =
        body.hideFromFriends ?? (user.hideFromFriends || user.rsvpVisibility === 'PRIVATE');

      const saved = existing
        ? await tx.rsvp.update({
            where: { id: existing.id },
            data: {
              status,
              showtimeId: body.showtimeId ?? null,
              ambassadorLinkId,
              inviteId,
              hideFromFriends,
              qrToken,
            },
          })
        : await tx.rsvp.create({
            data: {
              id: rsvpId,
              eventId: body.eventId,
              userId,
              status,
              showtimeId: body.showtimeId ?? null,
              ambassadorLinkId,
              inviteId,
              hideFromFriends,
              qrToken,
            },
          });

      if (status === 'CONFIRMED') {
        await tx.event.update({
          where: { id: body.eventId },
          data: { rsvpCount: { increment: 1 } },
        });
        if (lockedShowtime) {
          await tx.eventShowtime.update({
            where: { id: lockedShowtime.id },
            data: { rsvpCount: { increment: 1 } },
          });
        }
      }

      return { rsvp: saved, isNew: true };
    });

    if (outcome.isNew) {
      const payload: RsvpLifecyclePayload = {
        rsvpId: outcome.rsvp.id,
        eventId: outcome.rsvp.eventId,
        userId: outcome.rsvp.userId,
        status: outcome.rsvp.status,
      };
      this.eventsEmitter.emit(DOMAIN_EVENTS.RSVP_CREATED, payload);
    }

    return toRsvpContract(outcome.rsvp);
  }

  async cancelRsvp(userId: string, eventId: string): Promise<CancelRsvpResponse> {
    const result = await this.prisma.$transaction(async (tx) => {
      const lockedEvents = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE
      `;
      if (lockedEvents.length === 0) {
        throw new NotFoundException('Event not found');
      }

      const existing = await tx.rsvp.findUnique({
        where: {
          eventId_userId: { eventId, userId },
        },
      });
      if (!existing) {
        throw new NotFoundException('RSVP not found');
      }
      if (existing.status === 'CANCELLED') {
        return { cancelledRsvp: null, promotedRsvp: null };
      }

      const wasConfirmed = existing.status === 'CONFIRMED';
      const cancelledShowtimeId = existing.showtimeId;

      const cancelledRsvp = await tx.rsvp.update({
        where: { id: existing.id },
        data: { status: 'CANCELLED' },
      });

      let promotedRsvp: typeof cancelledRsvp | null = null;

      if (wasConfirmed) {
        await tx.event.update({
          where: { id: eventId },
          data: { rsvpCount: { decrement: 1 } },
        });
        if (cancelledShowtimeId) {
          await tx.eventShowtime.update({
            where: { id: cancelledShowtimeId },
            data: { rsvpCount: { decrement: 1 } },
          });
        }

        const waitlisted = await tx.rsvp.findMany({
          where: {
            eventId,
            status: 'WAITLISTED',
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { showtime: true },
          take: 25,
        });

        const eligible = waitlisted.find(
          (candidate) =>
            !candidate.showtime ||
            candidate.showtime.capacity === null ||
            candidate.showtime.rsvpCount < candidate.showtime.capacity,
        );

        if (eligible) {
          promotedRsvp = await tx.rsvp.update({
            where: { id: eligible.id },
            data: { status: 'CONFIRMED' },
          });
          await tx.event.update({
            where: { id: eventId },
            data: { rsvpCount: { increment: 1 } },
          });
          if (eligible.showtimeId) {
            await tx.eventShowtime.update({
              where: { id: eligible.showtimeId },
              data: { rsvpCount: { increment: 1 } },
            });
          }
        }
      }

      return { cancelledRsvp, promotedRsvp };
    });

    if (result.cancelledRsvp) {
      const cancelPayload: RsvpLifecyclePayload = {
        rsvpId: result.cancelledRsvp.id,
        eventId: result.cancelledRsvp.eventId,
        userId: result.cancelledRsvp.userId,
        status: 'CANCELLED',
      };
      this.eventsEmitter.emit(DOMAIN_EVENTS.RSVP_CANCELLED, cancelPayload);
    }

    if (result.promotedRsvp) {
      const promotePayload: RsvpLifecyclePayload = {
        rsvpId: result.promotedRsvp.id,
        eventId: result.promotedRsvp.eventId,
        userId: result.promotedRsvp.userId,
        status: 'CONFIRMED',
      };
      this.eventsEmitter.emit(DOMAIN_EVENTS.RSVP_PROMOTED, promotePayload);
    }

    return {
      cancelled: true,
      promotedRsvpId: result.promotedRsvp?.id ?? null,
    };
  }

  async listMyTickets(userId: string): Promise<AttendeeTicketsResponse> {
    const rsvps = await this.prisma.rsvp.findMany({
      where: { userId },
      orderBy: [{ event: { startsAt: 'asc' } }, { createdAt: 'asc' }],
      include: {
        event: {
          include: EVENT_PUBLIC_INCLUDE,
        },
      },
    });

    const enrichedEvents = await this.friendsGoing.enrichEvents(
      userId,
      rsvps.map((r) => r.event),
    );

    const items = rsvps.map((rsvp, index) => ({
      rsvp: toRsvpContract(rsvp),
      event: enrichedEvents[index]!,
    }));

    const active = items.filter((item) => item.rsvp.status !== 'CANCELLED');
    const activeSlugs = new Set(active.map((item) => item.event.slug));
    const groupedMap = new Map<string, string[]>();

    for (const item of active) {
      const parentSlug = item.event.parentEventSlug;
      const groupKey = parentSlug && activeSlugs.has(parentSlug) ? parentSlug : item.event.slug;
      const existing = groupedMap.get(groupKey) ?? [];
      existing.push(item.event.id);
      groupedMap.set(groupKey, existing);
    }

    const yourNightGroups: YourNightGroup[] = [...groupedMap.entries()].map(([key, eventIds]) => ({
      key,
      eventIds,
    }));

    return {
      items,
      yourNightGroups,
    };
  }

  async addInterest(userId: string, eventId: string): Promise<InterestedResponse> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    if (!event || event.status === 'DRAFT') {
      throw new NotFoundException('Event not found');
    }

    await this.prisma.eventInterest.upsert({
      where: {
        eventId_userId: { eventId, userId },
      },
      create: { eventId, userId },
      update: {},
    });

    const payload: InterestLifecyclePayload = { eventId, userId };
    this.eventsEmitter.emit(DOMAIN_EVENTS.INTEREST_ADDED, payload);

    return { eventId, interested: true };
  }

  async removeInterest(userId: string, eventId: string): Promise<InterestedResponse> {
    await this.prisma.eventInterest.deleteMany({
      where: { eventId, userId },
    });

    const payload: InterestLifecyclePayload = { eventId, userId };
    this.eventsEmitter.emit(DOMAIN_EVENTS.INTEREST_REMOVED, payload);

    return { eventId, interested: false };
  }

  async createAmbassadorLink(
    userId: string,
    body: CreateAmbassadorLinkBody,
  ): Promise<AmbassadorLinkResponse> {
    const creator = await this.prisma.creatorProfile.findUnique({
      where: { userId },
    });
    if (!creator || !creator.isVerified) {
      throw new ForbiddenException('Only verified campus creators can generate ambassador links');
    }

    const event = await this.prisma.event.findUnique({
      where: { id: body.eventId },
      select: { id: true, slug: true, status: true },
    });
    if (!event || event.status !== 'PUBLISHED') {
      throw new NotFoundException('Published event not found');
    }

    const existing = await this.prisma.ambassadorLink.findUnique({
      where: {
        creatorId_eventId: {
          creatorId: creator.id,
          eventId: event.id,
        },
      },
    });

    const link =
      existing ??
      (await this.prisma.ambassadorLink.create({
        data: {
          creatorId: creator.id,
          eventId: event.id,
          code: `${creator.handle.slice(0, 14)}-${randomBytes(3).toString('hex')}`,
        },
      }));

    return {
      id: link.id,
      creatorId: link.creatorId,
      eventId: link.eventId,
      code: link.code,
      shareUrl: `${this.webOrigin}/e/${event.slug}?ref=${encodeURIComponent(link.code)}`,
      clickCount: link.clickCount,
      rsvpCount: link.rsvpCount,
      checkInCount: link.checkInCount,
      createdAt: link.createdAt.toISOString(),
    };
  }

  async submitReport(userId: string, body: SubmitReportBody): Promise<ReportSubmittedResponse> {
    const event = await this.prisma.event.findUnique({
      where: { id: body.eventId },
      select: { id: true },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const report = await this.prisma.moderationReport.create({
      data: {
        reporterId: userId,
        targetType: 'EVENT',
        targetId: body.eventId,
        details: body.reason,
      },
    });

    return {
      id: report.id,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
    };
  }
}
