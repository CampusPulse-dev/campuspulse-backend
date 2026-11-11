import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EVENT_PUBLIC_INCLUDE,
  toEventPublic,
  toOrganizerPublic,
  type EventWithPublicRelations,
} from '../../common/mappers/entity.mappers';
import { PrismaService } from '../../common/prisma.service';
import type {
  CreatorPublic,
  CreatorAmbassadorLinksResponse,
  FeedResponse,
  FollowCreatorResponse,
  FollowOrganizerResponse,
  OrganizerPublic,
} from '../../contract';

@Injectable()
export class OrganizersService {
  constructor(private readonly prisma: PrismaService) {}

  async creatorLinks(userId: string): Promise<CreatorAmbassadorLinksResponse> {
    const creator = await this.prisma.creatorProfile.findUnique({
      where: { userId },
      select: { id: true, handle: true, isVerified: true },
    });
    if (!creator) throw new NotFoundException('Creator profile not found');
    const links = await this.prisma.ambassadorLink.findMany({
      where: { creatorId: creator.id },
      orderBy: { createdAt: 'desc' },
      include: { event: { include: EVENT_PUBLIC_INCLUDE } },
    });
    return {
      creator,
      items: links.map((link) => ({
        id: link.id,
        creatorId: link.creatorId,
        eventId: link.eventId,
        code: link.code,
        shareUrl: new URL(
          `/e/${link.event.slug}?ref=${encodeURIComponent(link.code)}`,
          process.env.WEB_ORIGIN ?? 'http://localhost:3000',
        ).toString(),
        clickCount: link.clickCount,
        rsvpCount: link.rsvpCount,
        checkInCount: link.checkInCount,
        createdAt: link.createdAt.toISOString(),
        event: toEventPublic(link.event),
      })),
    };
  }

  async getBySlug(slug: string): Promise<OrganizerPublic> {
    const organizer = await this.prisma.organizer.findUnique({
      where: { slug },
    });
    if (!organizer) {
      throw new NotFoundException(`No organizer with slug "${slug}"`);
    }
    return toOrganizerPublic(organizer);
  }

  async getEventsBySlug(slug: string): Promise<FeedResponse> {
    const organizer = await this.prisma.organizer.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!organizer) {
      throw new NotFoundException(`No organizer with slug "${slug}"`);
    }

    const events = await this.prisma.event.findMany({
      where: {
        organizerId: organizer.id,
        status: 'PUBLISHED',
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      include: EVENT_PUBLIC_INCLUDE,
    });

    return {
      items: events.map((e) => toEventPublic(e)),
      nextCursor: null,
    };
  }

  async followOrganizer(userId: string, organizerId: string): Promise<FollowOrganizerResponse> {
    return this.prisma.$transaction(async (tx) => {
      const organizer = await tx.organizer.findUnique({
        where: { id: organizerId },
        select: { id: true },
      });
      if (!organizer) {
        throw new NotFoundException('Organizer not found');
      }

      await tx.follow.upsert({
        where: { userId_organizerId: { userId, organizerId } },
        create: { userId, organizerId },
        update: {},
      });

      const followerCount = await tx.follow.count({ where: { organizerId } });
      await tx.organizer.update({
        where: { id: organizerId },
        data: { followerCount },
      });

      return { organizerId, following: true, followerCount };
    });
  }

  async unfollowOrganizer(userId: string, organizerId: string): Promise<FollowOrganizerResponse> {
    return this.prisma.$transaction(async (tx) => {
      const organizer = await tx.organizer.findUnique({
        where: { id: organizerId },
        select: { id: true },
      });
      if (!organizer) {
        throw new NotFoundException('Organizer not found');
      }

      await tx.follow.deleteMany({
        where: { userId, organizerId },
      });

      const followerCount = await tx.follow.count({ where: { organizerId } });
      await tx.organizer.update({
        where: { id: organizerId },
        data: { followerCount },
      });

      return { organizerId, following: false, followerCount };
    });
  }

  async getCreatorByHandle(rawHandle: string): Promise<CreatorPublic> {
    const handle = rawHandle.replace(/^@/, '').trim().toLowerCase();
    const creator = await this.prisma.creatorProfile.findUnique({
      where: { handle },
      include: {
        user: { select: { avatarUrl: true } },
        lineupCredits: {
          include: {
            event: { include: EVENT_PUBLIC_INCLUDE },
          },
        },
        ambassadorLinks: {
          include: {
            event: { include: EVENT_PUBLIC_INCLUDE },
          },
        },
      },
    });
    if (!creator) {
      throw new NotFoundException(`No creator with handle "${handle}"`);
    }

    const eventMap = new Map<string, EventWithPublicRelations>();
    for (const credit of creator.lineupCredits) {
      if (credit.event.status === 'PUBLISHED') {
        eventMap.set(credit.event.id, credit.event);
      }
    }
    for (const link of creator.ambassadorLinks) {
      if (link.event.status === 'PUBLISHED') {
        eventMap.set(link.event.id, link.event);
      }
    }

    const events = [...eventMap.values()]
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((e) => toEventPublic(e));

    return {
      id: creator.id,
      handle: creator.handle,
      displayName: creator.displayName,
      bio: creator.bio,
      avatarUrl: creator.user.avatarUrl,
      isVerified: creator.isVerified,
      followerCount: creator.followerCount,
      events,
    };
  }

  async followCreator(userId: string, creatorId: string): Promise<FollowCreatorResponse> {
    return this.prisma.$transaction(async (tx) => {
      const creator = await tx.creatorProfile.findUnique({
        where: { id: creatorId },
        select: { id: true },
      });
      if (!creator) {
        throw new NotFoundException('Creator not found');
      }

      await tx.creatorFollow.upsert({
        where: { userId_creatorId: { userId, creatorId } },
        create: { userId, creatorId },
        update: {},
      });

      const followerCount = await tx.creatorFollow.count({ where: { creatorId } });
      await tx.creatorProfile.update({
        where: { id: creatorId },
        data: { followerCount },
      });

      return { creatorId, following: true, followerCount };
    });
  }

  async unfollowCreator(userId: string, creatorId: string): Promise<FollowCreatorResponse> {
    return this.prisma.$transaction(async (tx) => {
      const creator = await tx.creatorProfile.findUnique({
        where: { id: creatorId },
        select: { id: true },
      });
      if (!creator) {
        throw new NotFoundException('Creator not found');
      }

      await tx.creatorFollow.deleteMany({
        where: { userId, creatorId },
      });

      const followerCount = await tx.creatorFollow.count({ where: { creatorId } });
      await tx.creatorProfile.update({
        where: { id: creatorId },
        data: { followerCount },
      });

      return { creatorId, following: false, followerCount };
    });
  }
}
