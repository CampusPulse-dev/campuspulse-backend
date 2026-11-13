import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, VerificationSubject as PrismaSubject } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { toOrganizerPublic, toUserPublic } from '../../common/mappers/entity.mappers';
import { PrismaService } from '../../common/prisma.service';
import { StorageService, type PrivateObject } from '../../common/storage/storage.service';
import type {
  AdminOverview,
  AdminVerificationItem,
  AdminVerificationQueueResponse,
  DecideVerificationBody,
  VerificationQueueQuery,
} from '../../contract';

export const CLAIM_LOCK_MS = 15 * 60 * 1000;
export const QUEUE_SLA_HOURS = 48;

const REQUEST_INCLUDE = { submittedBy: true, claimedBy: true } as const;
type RequestRow = Prisma.VerificationRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

/** Subjects each staff role may review. Student IDs are Super Admin only (NDPA). */
export function reviewableSubjects(role: AuthenticatedUser['role']): PrismaSubject[] {
  if (role === 'SUPER_ADMIN') {
    return ['ORGANIZER_CLUB', 'CREATOR_PROFILE', 'STUDENT_ID', 'VENDOR_CLAIM'];
  }
  if (role === 'VERIFIER') return ['ORGANIZER_CLUB', 'CREATOR_PROFILE', 'VENDOR_CLAIM'];
  return [];
}

function lockIsLive(claimedAt: Date | null, now: Date): boolean {
  return claimedAt !== null && now.getTime() - claimedAt.getTime() < CLAIM_LOCK_MS;
}

const DECISION_COPY = {
  APPROVED: { title: 'Verification approved', body: 'Your verification was approved.' },
  REJECTED: { title: 'Verification not approved', body: 'Your verification was not approved.' },
  INFO_REQUESTED: {
    title: 'More information needed',
    body: 'A reviewer needs more information to finish your verification.',
  },
} as const;

const SUBJECT_LINK: Record<PrismaSubject, string> = {
  STUDENT_ID: '/verify',
  ORGANIZER_CLUB: '/organizer',
  CREATOR_PROFILE: '/settings/creator',
  VENDOR_CLAIM: '/settings',
};

@Injectable()
export class AdminVerificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: VerificationQueueQuery,
  ): Promise<AdminVerificationQueueResponse> {
    const allowed = reviewableSubjects(actor.role);
    if (query.subject && !allowed.includes(query.subject)) {
      throw new ForbiddenException('You cannot review this verification queue');
    }

    const rows = await this.prisma.verificationRequest.findMany({
      where: {
        subject: query.subject ?? { in: allowed },
        status: query.status ?? { in: ['PENDING', 'IN_REVIEW'] },
      },
      include: REQUEST_INCLUDE,
      // Oldest first: the queue is worked against a 48-hour SLA.
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const pageRows = rows.slice(0, query.limit);
    return {
      items: await this.toItems(pageRows),
      nextCursor: rows.length > query.limit ? (pageRows[pageRows.length - 1]?.id ?? null) : null,
    };
  }

  /** 15-minute soft-lock. Re-claiming your own item extends it. */
  async claim(actor: AuthenticatedUser, id: string): Promise<AdminVerificationItem> {
    await this.loadReviewable(actor, id);
    const now = new Date();
    const claimed = await this.prisma.verificationRequest.updateMany({
      where: {
        id,
        status: { in: ['PENDING', 'IN_REVIEW'] },
        OR: [
          { claimedById: null },
          { claimedById: actor.id },
          { claimedAt: { lt: new Date(now.getTime() - CLAIM_LOCK_MS) } },
        ],
      },
      data: { claimedById: actor.id, claimedAt: now, status: 'IN_REVIEW' },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Another reviewer is working on this request');
    }
    return this.getItem(id);
  }

  /**
   * NDPA: the only path to a student ID image. Super Admin, holding the live
   * claim. The audit row is written BEFORE any bytes are read from storage.
   */
  async openDocument(actor: AuthenticatedUser, id: string): Promise<PrivateObject> {
    const request = await this.loadReviewable(actor, id);
    if (actor.role !== 'SUPER_ADMIN' || request.subject !== 'STUDENT_ID') {
      throw new ForbiddenException('Only a Super Admin can view student ID documents');
    }
    this.assertHoldsClaim(actor, request);
    if (!request.documentKey) throw new NotFoundException('The document has been deleted');

    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'verification.document.viewed',
        targetType: 'VerificationRequest',
        targetId: request.id,
        metadata: { subject: request.subject, submittedById: request.submittedById },
      },
    });
    return this.storage.getPrivateObject(request.documentKey);
  }

  async decide(
    actor: AuthenticatedUser,
    id: string,
    body: DecideVerificationBody,
  ): Promise<AdminVerificationItem> {
    const request = await this.loadReviewable(actor, id);
    if (request.status !== 'PENDING' && request.status !== 'IN_REVIEW') {
      throw new ConflictException('This request has already been decided');
    }
    this.assertHoldsClaim(actor, request);

    // NDPA: the image goes first. If anything after this fails, the worst
    // outcome is a request with no document, never a decided request with one.
    if (request.documentKey) {
      await this.storage.deletePrivateObject(request.documentKey);
    }

    const copy = DECISION_COPY[body.decision];
    await this.prisma.$transaction(async (tx) => {
      const decided = await tx.verificationRequest.updateMany({
        where: { id, claimedById: actor.id, status: { in: ['PENDING', 'IN_REVIEW'] } },
        data: {
          status: body.decision,
          reviewerNote: body.note,
          decidedAt: new Date(),
          documentKey: null,
          claimedById: null,
          claimedAt: null,
        },
      });
      if (decided.count !== 1) throw new ConflictException('This request changed. Reload it.');

      if (body.decision === 'APPROVED') {
        await this.applyApproval(tx, request);
      }

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: `verification.${body.decision.toLowerCase()}`,
          targetType: 'VerificationRequest',
          targetId: id,
          metadata: {
            subject: request.subject,
            submittedById: request.submittedById,
            documentDeleted: request.documentKey !== null,
          },
        },
      });
      await tx.notification.create({
        data: {
          userId: request.submittedById,
          category: 'SYSTEM_VERIFICATION',
          title: copy.title,
          body: body.note ? `${copy.body} Reviewer note: ${body.note}` : copy.body,
          linkUrl: SUBJECT_LINK[request.subject],
        },
      });
    });

    return this.getItem(id);
  }

  async overview(actor: AuthenticatedUser): Promise<AdminOverview> {
    const allowed = reviewableSubjects(actor.role);
    const canModerate = actor.role === 'MODERATOR' || actor.role === 'SUPER_ADMIN';
    const open = { status: { in: ['PENDING', 'IN_REVIEW'] as ('PENDING' | 'IN_REVIEW')[] } };

    const count = (subject: PrismaSubject) =>
      allowed.includes(subject)
        ? this.prisma.verificationRequest.count({ where: { ...open, subject } })
        : Promise.resolve(null);

    const [organizerClub, creatorProfile, studentId, openReports, oldest] = await Promise.all([
      count('ORGANIZER_CLUB'),
      count('CREATOR_PROFILE'),
      count('STUDENT_ID'),
      canModerate
        ? this.prisma.moderationReport.count({ where: { status: 'OPEN' } })
        : Promise.resolve(null),
      allowed.length > 0
        ? this.prisma.verificationRequest.findFirst({
            where: { ...open, subject: { in: allowed } },
            orderBy: { submittedAt: 'asc' },
            select: { submittedAt: true },
          })
        : Promise.resolve(null),
    ]);

    return {
      pendingVerifications: {
        organizerClub: organizerClub ?? 0,
        creatorProfile: creatorProfile ?? 0,
        studentId,
      },
      openReports,
      oldestPendingSubmittedAt: oldest?.submittedAt.toISOString() ?? null,
      slaHours: QUEUE_SLA_HOURS,
    };
  }

  private async applyApproval(tx: Prisma.TransactionClient, request: RequestRow): Promise<void> {
    const userId = request.submittedById;
    if (request.subject === 'STUDENT_ID') {
      await tx.user.update({ where: { id: userId }, data: { isVerifiedStudent: true } });
      return;
    }
    if (request.subject === 'ORGANIZER_CLUB') {
      await tx.organizer.updateMany({ where: { ownerId: userId }, data: { isVerified: true } });
      // Promote plain attendees only; never downgrade staff.
      await tx.user.updateMany({
        where: { id: userId, role: 'ATTENDEE' },
        data: { role: 'ORGANIZER' },
      });
      return;
    }
    if (request.subject === 'CREATOR_PROFILE') {
      await tx.creatorProfile.updateMany({ where: { userId }, data: { isVerified: true } });
      await tx.user.updateMany({
        where: { id: userId, role: 'ATTENDEE' },
        data: { role: 'CREATOR' },
      });
    }
  }

  private assertHoldsClaim(actor: AuthenticatedUser, request: RequestRow): void {
    if (request.claimedById !== actor.id || !lockIsLive(request.claimedAt, new Date())) {
      throw new ConflictException('Claim this request before reviewing it');
    }
  }

  /** 404 (not 403) for subjects outside the caller's remit, so the queue does not leak. */
  private async loadReviewable(actor: AuthenticatedUser, id: string): Promise<RequestRow> {
    const request = await this.prisma.verificationRequest.findUnique({
      where: { id },
      include: REQUEST_INCLUDE,
    });
    if (!request || !reviewableSubjects(actor.role).includes(request.subject)) {
      throw new NotFoundException('Verification request not found');
    }
    return request;
  }

  private async getItem(id: string): Promise<AdminVerificationItem> {
    const row = await this.prisma.verificationRequest.findUniqueOrThrow({
      where: { id },
      include: REQUEST_INCLUDE,
    });
    const [item] = await this.toItems([row]);
    if (!item) throw new NotFoundException('Verification request not found');
    return item;
  }

  private async toItems(rows: RequestRow[]): Promise<AdminVerificationItem[]> {
    const ownerIds = rows.filter((r) => r.subject === 'ORGANIZER_CLUB').map((r) => r.submittedById);
    const creatorIds = rows
      .filter((r) => r.subject === 'CREATOR_PROFILE')
      .map((r) => r.submittedById);

    const [organizers, creators] = await Promise.all([
      ownerIds.length > 0
        ? this.prisma.organizer.findMany({ where: { ownerId: { in: ownerIds } } })
        : Promise.resolve([]),
      creatorIds.length > 0
        ? this.prisma.creatorProfile.findMany({
            where: { userId: { in: creatorIds } },
            select: { userId: true, handle: true },
          })
        : Promise.resolve([]),
    ]);
    const organizerByOwner = new Map(organizers.map((o) => [o.ownerId, o]));
    const handleByUser = new Map(creators.map((c) => [c.userId, c.handle]));
    const now = new Date();

    return rows.map((row) => {
      const organizer =
        row.subject === 'ORGANIZER_CLUB' ? organizerByOwner.get(row.submittedById) : undefined;
      const locked = lockIsLive(row.claimedAt, now);
      return {
        id: row.id,
        subject: row.subject,
        status: row.status,
        submittedBy: toUserPublic(row.submittedBy),
        submittedAt: row.submittedAt.toISOString(),
        claimedBy: locked && row.claimedBy ? toUserPublic(row.claimedBy) : null,
        claimedAt: locked && row.claimedAt ? row.claimedAt.toISOString() : null,
        reviewerNote: row.reviewerNote,
        decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
        evidenceUrl: row.evidenceUrl,
        hasDocument: row.documentKey !== null,
        lockExpiresAt:
          locked && row.claimedAt
            ? new Date(row.claimedAt.getTime() + CLAIM_LOCK_MS).toISOString()
            : null,
        organizer: organizer ? toOrganizerPublic(organizer) : null,
        creatorHandle:
          row.subject === 'CREATOR_PROFILE' ? (handleByUser.get(row.submittedById) ?? null) : null,
      };
    });
  }
}
