import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { maskEmail } from '../../common/mask-email';
import { toOrganizerPublic } from '../../common/mappers/entity.mappers';
import { PrismaService } from '../../common/prisma.service';
import type {
  CreatorApplyBody,
  MyOrganizersResponse,
  OrganizerMembership,
  SubmitOrganizerVerificationBody,
  TeamResponse,
  VerificationStatus,
  VerificationSubmittedResponse,
} from '../../contract';
import { OrganizerAccessService } from './organizer-access.service';

/** Slugs that would collide with fixed `/organizers/*` routes. */
const RESERVED_SLUGS = new Set(['mine', 'apply', 'new', 'admin']);

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Club applications, "my clubs", and Owner-managed teams (S1-03).
 * A club exists from the moment it applies, but stays `isVerified: false`
 * until a reviewer approves its ORGANIZER_CLUB request (S1-04).
 */
@Injectable()
export class OrganizerTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizerAccessService,
  ) {}

  async apply(userId: string, body: SubmitOrganizerVerificationBody): Promise<OrganizerMembership> {
    if (RESERVED_SLUGS.has(body.slug)) {
      throw new ConflictException('This club link is not available');
    }
    const owned = await this.prisma.organizer.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });
    if (owned) throw new ConflictException('You already own a club on CampusPulse');

    try {
      const organizer = await this.prisma.$transaction(async (tx) => {
        const created = await tx.organizer.create({
          data: { slug: body.slug, name: body.organizerName.trim(), ownerId: userId },
        });
        await tx.organizerMember.create({
          data: { organizerId: created.id, userId, role: 'OWNER' },
        });
        await tx.verificationRequest.create({
          data: {
            subject: 'ORGANIZER_CLUB',
            submittedById: userId,
            evidenceUrl: body.evidenceUrl,
          },
        });
        return created;
      });
      return {
        organizer: toOrganizerPublic(organizer),
        role: 'OWNER',
        verificationStatus: 'PENDING',
        reviewerNote: null,
      };
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('This club link is already taken');
      throw err;
    }
  }

  async listMine(userId: string): Promise<MyOrganizersResponse> {
    const memberships = await this.prisma.organizerMember.findMany({
      where: { userId },
      include: { organizer: true },
      orderBy: { createdAt: 'asc' },
    });
    if (memberships.length === 0) return { items: [] };

    // Club requests carry no organizer FK; the owner (one club each) is the link.
    const requests = await this.prisma.verificationRequest.findMany({
      where: {
        subject: 'ORGANIZER_CLUB',
        submittedById: { in: memberships.map((m) => m.organizer.ownerId) },
      },
      orderBy: { submittedAt: 'desc' },
      select: { submittedById: true, status: true, reviewerNote: true },
    });
    const latestByOwner = new Map<string, { status: VerificationStatus; note: string | null }>();
    for (const request of requests) {
      if (!latestByOwner.has(request.submittedById)) {
        latestByOwner.set(request.submittedById, {
          status: request.status,
          note: request.reviewerNote,
        });
      }
    }

    return {
      items: memberships.map((membership) => {
        const latest = latestByOwner.get(membership.organizer.ownerId);
        return {
          organizer: toOrganizerPublic(membership.organizer),
          role: membership.role,
          verificationStatus: membership.organizer.isVerified
            ? 'APPROVED'
            : (latest?.status ?? 'PENDING'),
          reviewerNote: membership.organizer.isVerified ? null : (latest?.note ?? null),
        };
      }),
    };
  }

  /** Caller must already be on the team (enforced by OrganizerAccessGuard). */
  async getTeam(userId: string, organizerId: string): Promise<TeamResponse> {
    const members = await this.prisma.organizerMember.findMany({
      where: { organizerId },
      include: { user: { select: { id: true, displayName: true, email: true } } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    const self = members.find((m) => m.userId === userId);
    if (!self) throw new NotFoundException('Club not found');
    const grants = await this.prisma.doorStaffGrant.findMany({
      where: { event: { organizerId }, expiresAt: { gt: new Date() } },
      include: {
        event: { select: { title: true } },
        user: { select: { displayName: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      organizerId,
      role: self.role,
      doorStaff: grants.map((g) => ({
        id: g.id,
        eventId: g.eventId,
        eventTitle: g.event.title,
        userId: g.userId,
        displayName: g.user.displayName,
        emailHint: maskEmail(g.user.email),
        expiresAt: g.expiresAt.toISOString(),
        createdAt: g.createdAt.toISOString(),
      })),
      members: members.map((m) => ({
        userId: m.userId,
        displayName: m.user.displayName,
        emailHint: m.userId === userId ? null : maskEmail(m.user.email),
        role: m.role,
      })),
    };
  }

  async addManager(ownerId: string, organizerId: string, rawEmail: string): Promise<TeamResponse> {
    await this.access.assertRole(ownerId, organizerId, ['OWNER']);
    const target = await this.prisma.user.findUnique({
      where: { email: rawEmail.trim().toLowerCase() },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException('No CampusPulse account uses this email. Ask them to sign up.');
    }
    try {
      await this.prisma.organizerMember.create({
        data: { organizerId, userId: target.id, role: 'MANAGER' },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Already on the team');
      throw err;
    }
    return this.getTeam(ownerId, organizerId);
  }

  async removeMember(ownerId: string, organizerId: string, userId: string): Promise<TeamResponse> {
    await this.access.assertRole(ownerId, organizerId, ['OWNER']);
    const member = await this.prisma.organizerMember.findUnique({
      where: { organizerId_userId: { organizerId, userId } },
      select: { role: true },
    });
    if (!member) throw new NotFoundException('Team member not found');
    if (member.role === 'OWNER') throw new BadRequestException('The club owner cannot be removed');

    await this.prisma.organizerMember.delete({
      where: { organizerId_userId: { organizerId, userId } },
    });
    return this.getTeam(ownerId, organizerId);
  }

  async applyAsCreator(
    userId: string,
    body: CreatorApplyBody,
  ): Promise<VerificationSubmittedResponse> {
    const existing = await this.prisma.creatorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (existing) throw new ConflictException('You already have a creator profile');

    try {
      const request = await this.prisma.$transaction(async (tx) => {
        await tx.creatorProfile.create({
          data: {
            userId,
            handle: body.handle,
            displayName: body.displayName,
            bio: body.bio,
            instagramUrl: body.instagramUrl,
            tiktokUrl: body.tiktokUrl,
          },
        });
        return tx.verificationRequest.create({
          data: { subject: 'CREATOR_PROFILE', submittedById: userId },
        });
      });
      return { id: request.id, subject: request.subject, status: request.status };
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('This handle is already taken');
      throw err;
    }
  }
}
