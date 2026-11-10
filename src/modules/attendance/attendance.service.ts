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
  CheckIn,
  CheckInBatchBody,
  CheckInBatchResponse,
  CheckInBody,
  CheckInResponse,
  CreateAmbassadorLinkBody,
  CreateRsvpBody,
  CreateRsvpResponse,
  EventStatsResponse,
  InterestedResponse,
  ReportSubmittedResponse,
  RosterEntry,
  RosterQuery,
  RosterResponse,
  Rsvp,
  ScannerPackResponse,
  SubmitReportBody,
  YourNightGroup,
} from '../../contract';
import { FriendsGoingService } from '../identity/friends-going.service';
import { OrganizerAccessService } from '../identity/organizer-access.service';
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

interface LockedRsvpRow {
  id: string;
  eventId: string;
  userId: string;
  status: string;
  ambassadorLinkId: string | null;
}

const FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r']);

function escapeCsvField(raw: string | number | boolean | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  let text = String(raw);
  if (text.length > 0 && FORMULA_PREFIXES.has(text[0]!)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text) || text.startsWith("'")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCheckInContract(row: {
  id: string;
  eventId: string;
  rsvpId: string | null;
  method: CheckIn['method'];
  scannedAt: Date;
  checkedInById: string;
  isDuplicate: boolean;
}): CheckIn {
  return {
    id: row.id,
    eventId: row.eventId,
    rsvpId: row.rsvpId,
    method: row.method,
    checkedInAt: row.scannedAt.toISOString(),
    checkedInBy: row.checkedInById,
    isDuplicate: row.isDuplicate,
  };
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
    private readonly organizerAccess: OrganizerAccessService,
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

    const outcome = await this.prisma.$transaction(
      async (tx) => {
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
      },
      { maxWait: 15_000, timeout: 15_000 },
    );

    if (outcome.isNew) {
      const payload: RsvpLifecyclePayload = {
        rsvpId: outcome.rsvp.id,
        eventId: outcome.rsvp.eventId,
        userId: outcome.rsvp.userId,
        status: outcome.rsvp.status,
      };
      await this.eventsEmitter.emitAsync(DOMAIN_EVENTS.RSVP_CREATED, payload);
    }

    return toRsvpContract(outcome.rsvp);
  }

  async cancelRsvp(userId: string, eventId: string): Promise<CancelRsvpResponse> {
    const result = await this.prisma.$transaction(
      async (tx) => {
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
      },
      { maxWait: 15_000, timeout: 15_000 },
    );

    if (result.cancelledRsvp) {
      const cancelPayload: RsvpLifecyclePayload = {
        rsvpId: result.cancelledRsvp.id,
        eventId: result.cancelledRsvp.eventId,
        userId: result.cancelledRsvp.userId,
        status: 'CANCELLED',
      };
      await this.eventsEmitter.emitAsync(DOMAIN_EVENTS.RSVP_CANCELLED, cancelPayload);
    }

    if (result.promotedRsvp) {
      const promotePayload: RsvpLifecyclePayload = {
        rsvpId: result.promotedRsvp.id,
        eventId: result.promotedRsvp.eventId,
        userId: result.promotedRsvp.userId,
        status: 'CONFIRMED',
      };
      await this.eventsEmitter.emitAsync(DOMAIN_EVENTS.RSVP_PROMOTED, promotePayload);
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
    await this.eventsEmitter.emitAsync(DOMAIN_EVENTS.INTEREST_ADDED, payload);

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

  async getScannerPack(userId: string, eventId: string): Promise<ScannerPackResponse> {
    await this.organizerAccess.assertDoorAccess(userId, eventId);

    const rsvps = await this.prisma.rsvp.findMany({
      where: {
        eventId,
        status: 'CONFIRMED',
      },
      orderBy: [{ user: { displayName: 'asc' } }, { createdAt: 'asc' }],
      select: {
        id: true,
        qrToken: true,
        user: {
          select: {
            displayName: true,
            isVerifiedStudent: true,
          },
        },
        checkIns: {
          where: {
            eventId,
            isDuplicate: false,
          },
          orderBy: { scannedAt: 'asc' },
          take: 1,
          select: { scannedAt: true },
        },
      },
    });

    return {
      eventId,
      publicKey: this.qrTokens.getPublicKey(),
      syncedAt: new Date().toISOString(),
      roster: rsvps.map((rsvp) => ({
        rsvpId: rsvp.id,
        displayName: rsvp.user.displayName,
        isVerifiedStudent: rsvp.user.isVerifiedStudent,
        qrTokenDigest: this.qrTokens.digest(rsvp.qrToken),
        checkedInAt: rsvp.checkIns[0]?.scannedAt.toISOString() ?? null,
      })),
    };
  }

  async getRoster(userId: string, eventId: string, query: RosterQuery): Promise<RosterResponse> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, organizerId: true },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    await this.organizerAccess.assertRole(userId, event.organizerId, ['OWNER', 'MANAGER']);

    const rsvps = await this.prisma.rsvp.findMany({
      where: {
        eventId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              user: {
                displayName: { contains: query.search, mode: 'insensitive' },
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            isVerifiedStudent: true,
            hall: true,
            faculty: true,
          },
        },
        showtime: {
          select: { label: true },
        },
        checkIns: {
          where: {
            eventId,
            isDuplicate: false,
          },
          orderBy: { scannedAt: 'asc' },
          take: 1,
          select: {
            scannedAt: true,
            method: true,
          },
        },
      },
    });

    const items: RosterEntry[] = rsvps.map((rsvp) => {
      const firstCheckIn = rsvp.checkIns[0];
      return {
        rsvpId: rsvp.id,
        userId: rsvp.user.id,
        displayName: rsvp.user.displayName,
        isVerifiedStudent: rsvp.user.isVerifiedStudent,
        badge: rsvp.user.isVerifiedStudent ? 'VERIFIED_STUDENT' : 'GUEST',
        hall: rsvp.user.hall,
        faculty: rsvp.user.faculty,
        status: rsvp.status,
        showtimeLabel: rsvp.showtime?.label ?? null,
        checkedIn: firstCheckIn !== undefined,
        checkedInAt: firstCheckIn?.scannedAt.toISOString() ?? null,
        checkInMethod: firstCheckIn?.method ?? null,
        createdAt: rsvp.createdAt.toISOString(),
      };
    });

    return {
      eventId,
      items,
    };
  }

  formatRosterCsv(roster: RosterResponse): string {
    const header = [
      'rsvpId',
      'displayName',
      'badge',
      'hall',
      'faculty',
      'status',
      'showtimeLabel',
      'checkedIn',
      'checkedInAt',
      'checkInMethod',
      'createdAt',
    ].join(',');

    const lines = roster.items.map((item) =>
      [
        escapeCsvField(item.rsvpId),
        escapeCsvField(item.displayName),
        escapeCsvField(item.badge),
        escapeCsvField(item.hall),
        escapeCsvField(item.faculty),
        escapeCsvField(item.status),
        escapeCsvField(item.showtimeLabel),
        escapeCsvField(item.checkedIn),
        escapeCsvField(item.checkedInAt),
        escapeCsvField(item.checkInMethod),
        escapeCsvField(item.createdAt),
      ].join(','),
    );

    return [header, ...lines].join('\r\n') + '\r\n';
  }

  async checkIn(actorUserId: string, body: CheckInBody): Promise<CheckInResponse> {
    await this.organizerAccess.assertDoorAccess(actorUserId, body.eventId);
    return this.processSingleCheckIn(actorUserId, body);
  }

  async checkInBatch(actorUserId: string, body: CheckInBatchBody): Promise<CheckInBatchResponse> {
    const distinctEventIds = [...new Set(body.checkIns.map((item) => item.eventId))];
    for (const eventId of distinctEventIds) {
      await this.organizerAccess.assertDoorAccess(actorUserId, eventId);
    }

    const ordered = body.checkIns
      .map((item, index) => ({
        item,
        index,
        scannedMs: new Date(item.scannedAt).getTime(),
      }))
      .sort((a, b) => a.scannedMs - b.scannedMs || a.index - b.index);

    const results = new Array<CheckInResponse>(body.checkIns.length);
    for (const entry of ordered) {
      results[entry.index] = await this.processSingleCheckIn(actorUserId, entry.item);
    }

    return { results };
  }

  async getEventStats(userId: string, eventId: string): Promise<EventStatsResponse> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        organizerId: true,
        rsvpCount: true,
        checkInCount: true,
      },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    await this.organizerAccess.assertRole(userId, event.organizerId, ['OWNER', 'MANAGER']);

    const [duplicateScanCount, manualCheckInCount] = await Promise.all([
      this.prisma.checkIn.count({
        where: { eventId, isDuplicate: true },
      }),
      this.prisma.checkIn.count({
        where: { eventId, method: 'MANUAL', isDuplicate: false },
      }),
    ]);

    const conversionRate =
      event.rsvpCount > 0
        ? Math.min(1, Number((event.checkInCount / event.rsvpCount).toFixed(4)))
        : 0;

    return {
      eventId: event.id,
      rsvpCount: event.rsvpCount,
      checkInCount: event.checkInCount,
      conversionRate,
      duplicateScanCount,
      manualCheckInCount,
    };
  }

  private async processSingleCheckIn(
    actorUserId: string,
    body: CheckInBody,
  ): Promise<CheckInResponse> {
    const scannedAtDate = new Date(body.scannedAt);
    if (Number.isNaN(scannedAtDate.getTime())) {
      throw new BadRequestException('Invalid scannedAt timestamp');
    }

    let targetRsvpId: string;
    if (body.method === 'QR_SCAN') {
      if (!body.qrToken) {
        throw new BadRequestException('qrToken is required for QR_SCAN check-in');
      }
      const verified = this.qrTokens.verify(body.qrToken);
      if (!verified) {
        throw new BadRequestException('Invalid QR token signature');
      }
      if (verified.eventId !== body.eventId) {
        throw new BadRequestException('QR token belongs to a different event');
      }
      if (body.rsvpId && body.rsvpId !== verified.rsvpId) {
        throw new BadRequestException('rsvpId does not match signed QR token');
      }
      targetRsvpId = verified.rsvpId;
    } else {
      if (body.rsvpId) {
        targetRsvpId = body.rsvpId;
      } else if (body.qrToken) {
        const verified = this.qrTokens.verify(body.qrToken);
        if (!verified || verified.eventId !== body.eventId) {
          throw new BadRequestException('Invalid QR token for manual check-in');
        }
        targetRsvpId = verified.rsvpId;
      } else {
        throw new BadRequestException('rsvpId is required for manual check-in');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const lockedRsvps = await tx.$queryRaw<LockedRsvpRow[]>`
        SELECT id, "eventId", "userId", status, "ambassadorLinkId"
        FROM "Rsvp"
        WHERE id = ${targetRsvpId}::uuid
        FOR UPDATE
      `;
      const rsvp = lockedRsvps[0];
      if (!rsvp || rsvp.eventId !== body.eventId) {
        throw new NotFoundException('RSVP not found for this event');
      }
      if (rsvp.status !== 'CONFIRMED') {
        throw new ConflictException('Only confirmed RSVPs can be checked in');
      }

      const [event, attendee] = await Promise.all([
        tx.event.findUnique({
          where: { id: body.eventId },
          select: {
            id: true,
            parentEventId: true,
            linkType: true,
            afterPartyAccess: true,
          },
        }),
        tx.user.findUnique({
          where: { id: rsvp.userId },
          select: { displayName: true },
        }),
      ]);
      if (!event) {
        throw new NotFoundException('Event not found');
      }

      if (
        event.parentEventId &&
        event.linkType === 'AFTER_PARTY' &&
        event.afterPartyAccess === 'CHECKED_IN_ONLY'
      ) {
        const parentCheckIn = await tx.checkIn.findFirst({
          where: {
            eventId: event.parentEventId,
            rsvp: { userId: rsvp.userId },
          },
          select: { id: true },
        });
        if (!parentCheckIn) {
          throw new ForbiddenException(
            'Check-in at the parent event is required before entering this after-party',
          );
        }
      }

      const attendeeName = attendee?.displayName ?? 'Attendee';

      // Exact offline batch retry idempotency check
      const exactReplay = await tx.checkIn.findFirst({
        where: {
          eventId: body.eventId,
          rsvpId: rsvp.id,
          checkedInById: actorUserId,
          method: body.method,
          scannedAt: scannedAtDate,
        },
      });
      if (exactReplay) {
        return {
          checkIn: toCheckInContract(exactReplay),
          attendeeName,
          duplicate: exactReplay.isDuplicate,
        };
      }

      const priorCheckIn = await tx.checkIn.findFirst({
        where: {
          eventId: body.eventId,
          rsvpId: rsvp.id,
        },
        select: { id: true },
      });
      const isDuplicate = priorCheckIn !== null;

      const created = await tx.checkIn.create({
        data: {
          eventId: body.eventId,
          rsvpId: rsvp.id,
          method: body.method,
          scannedAt: scannedAtDate,
          checkedInAt: scannedAtDate,
          checkedInById: actorUserId,
          isDuplicate,
        },
      });

      if (!isDuplicate) {
        await tx.event.update({
          where: { id: body.eventId },
          data: { checkInCount: { increment: 1 } },
        });
        if (rsvp.ambassadorLinkId) {
          await tx.ambassadorLink.update({
            where: { id: rsvp.ambassadorLinkId },
            data: { checkInCount: { increment: 1 } },
          });
        }
      }

      return {
        checkIn: toCheckInContract(created),
        attendeeName,
        duplicate: isDuplicate,
      };
    });
  }
}
