import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { DOMAIN_EVENTS, type EventCancelledPayload } from '../../common/domain-events';
import { toUserPublic } from '../../common/mappers/entity.mappers';
import { PrismaService } from '../../common/prisma.service';
import type {
  AdminReport,
  AdminReportsQuery,
  AdminReportsResponse,
  ReportStatus,
  ResolveReportBody,
} from '../../contract';

const STAFF_ROLES = new Set(['VERIFIER', 'MODERATOR', 'SUPER_ADMIN']);
const REPORT_INCLUDE = { reporter: true } as const;
type ReportRow = Prisma.ModerationReportGetPayload<{ include: typeof REPORT_INCLUDE }>;

function toStatus(raw: string): ReportStatus {
  return raw === 'RESOLVED' || raw === 'DISMISSED' ? raw : 'OPEN';
}

@Injectable()
export class AdminModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async list(query: AdminReportsQuery): Promise<AdminReportsResponse> {
    const rows = await this.prisma.moderationReport.findMany({
      where: { status: query.status },
      include: REPORT_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const pageRows = rows.slice(0, query.limit);
    return {
      items: await this.toReports(pageRows),
      nextCursor: rows.length > query.limit ? (pageRows[pageRows.length - 1]?.id ?? null) : null,
    };
  }

  async resolve(
    actor: AuthenticatedUser,
    id: string,
    body: ResolveReportBody,
  ): Promise<AdminReport> {
    const report = await this.prisma.moderationReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== 'OPEN') throw new ConflictException('This report is already closed');

    let cancelled: EventCancelledPayload | null = null;

    await this.prisma.$transaction(async (tx) => {
      const closed = await tx.moderationReport.updateMany({
        where: { id, status: 'OPEN' },
        data: {
          status: body.action === 'DISMISS' ? 'DISMISSED' : 'RESOLVED',
          resolvedById: actor.id,
          resolutionNote: body.note,
        },
      });
      if (closed.count !== 1) throw new ConflictException('This report is already closed');

      const metadata: Record<string, string> = {
        action: body.action,
        targetType: report.targetType,
        targetId: report.targetId,
      };

      if (body.action === 'UNPUBLISH_EVENT') {
        if (report.targetType !== 'EVENT') {
          throw new BadRequestException('This report is not about an event');
        }
        const event = await tx.event.findUnique({
          where: { id: report.targetId },
          select: { id: true, slug: true, title: true, status: true },
        });
        if (!event) throw new NotFoundException('The reported event no longer exists');
        if (event.status === 'PUBLISHED') {
          // A takedown is a cancellation as far as RSVP holders are concerned.
          await tx.event.update({ where: { id: event.id }, data: { status: 'CANCELLED' } });
          cancelled = {
            eventId: event.id,
            slug: event.slug,
            title: event.title,
            reason: 'Removed by CampusPulse moderation',
          };
        }
      }

      if (body.action === 'REMOVE_STORY') {
        if (report.targetType !== 'STORY') {
          throw new BadRequestException('This report is not about a story');
        }
        await tx.story.deleteMany({ where: { id: report.targetId } });
      }

      if (body.action === 'SUSPEND_USER' && body.userId) {
        await suspendUser(tx, actor, body.userId);
        metadata.suspendedUserId = body.userId;
      }

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: `moderation.${body.action.toLowerCase()}`,
          targetType: 'ModerationReport',
          targetId: id,
          metadata,
        },
      });
    });

    if (cancelled) this.events.emit(DOMAIN_EVENTS.EVENT_CANCELLED, cancelled);

    const row = await this.prisma.moderationReport.findUniqueOrThrow({
      where: { id },
      include: REPORT_INCLUDE,
    });
    const [item] = await this.toReports([row]);
    if (!item) throw new NotFoundException('Report not found');
    return item;
  }

  private async toReports(rows: ReportRow[]): Promise<AdminReport[]> {
    const idsOf = (type: string) =>
      rows.filter((r) => r.targetType === type).map((r) => r.targetId);
    const eventIds = idsOf('EVENT');
    const storyIds = idsOf('STORY');

    const [events, stories] = await Promise.all([
      eventIds.length > 0
        ? this.prisma.event.findMany({
            where: { id: { in: eventIds } },
            select: { id: true, title: true },
          })
        : Promise.resolve([]),
      storyIds.length > 0
        ? this.prisma.story.findMany({
            where: { id: { in: storyIds } },
            select: { id: true, caption: true, organizer: { select: { name: true } } },
          })
        : Promise.resolve([]),
    ]);
    const labels = new Map<string, string>();
    for (const event of events) labels.set(`EVENT:${event.id}`, event.title);
    for (const story of stories) {
      labels.set(`STORY:${story.id}`, story.caption ?? `Story by ${story.organizer.name}`);
    }

    return rows.map((row) => ({
      id: row.id,
      reporter: toUserPublic(row.reporter),
      targetType: row.targetType,
      targetId: row.targetId,
      targetLabel: labels.get(`${row.targetType}:${row.targetId}`) ?? null,
      reasonCategory: row.reasonCategory,
      details: row.details,
      status: toStatus(row.status),
      resolutionNote: row.resolutionNote,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

/**
 * Suspends an account and ends its session. Only a Super Admin may suspend
 * staff, and nobody may suspend themselves.
 */
export async function suspendUser(
  tx: Prisma.TransactionClient,
  actor: AuthenticatedUser,
  userId: string,
): Promise<void> {
  if (userId === actor.id) throw new BadRequestException('You cannot suspend your own account');
  const target = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!target) throw new NotFoundException('User not found');
  if (STAFF_ROLES.has(target.role) && actor.role !== 'SUPER_ADMIN') {
    throw new ForbiddenException('Only a Super Admin can suspend staff accounts');
  }
  await tx.user.update({
    where: { id: userId },
    data: { suspendedAt: new Date(), refreshTokenHash: null },
  });
}
