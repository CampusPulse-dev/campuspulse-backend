import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { toOrganizerPublic, toStoryContract } from '../../common/mappers/entity.mappers';
import { PrismaService } from '../../common/prisma.service';
import type { CreateStoryBody, OrganizerPublic, StoriesResponse, Story } from '../../contract';
import { OrganizerAccessService } from '../identity/organizer-access.service';

const STORY_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class StoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizerAccess: OrganizerAccessService,
  ) {}

  async listActive(viewerId?: string): Promise<StoriesResponse> {
    const now = new Date();
    const [activeStories, viewerFollows] = await Promise.all([
      this.prisma.story.findMany({
        where: {
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
        include: { organizer: true },
      }),
      viewerId
        ? this.prisma.follow.findMany({
            where: { userId: viewerId },
            select: { organizerId: true },
          })
        : Promise.resolve([]),
    ]);

    const followedSet = new Set(viewerFollows.map((f) => f.organizerId));
    const groupMap = new Map<
      string,
      {
        organizer: OrganizerPublic;
        following: boolean;
        newestAt: number;
        stories: Story[];
      }
    >();

    for (const row of activeStories) {
      const mapped = toStoryContract(row);
      const existing = groupMap.get(row.organizerId);
      if (existing) {
        existing.stories.push(mapped);
      } else {
        groupMap.set(row.organizerId, {
          organizer: toOrganizerPublic(row.organizer),
          following: followedSet.has(row.organizerId),
          newestAt: row.createdAt.getTime(),
          stories: [mapped],
        });
      }
    }

    const sortedGroups = [...groupMap.values()].sort((a, b) => {
      const followDiff = Number(b.following) - Number(a.following);
      if (followDiff !== 0) return followDiff;
      return b.newestAt - a.newestAt;
    });

    const groups = sortedGroups.map(({ organizer, following, stories }) => ({
      organizer,
      following,
      stories,
    }));

    return {
      items: groups.flatMap((g) => g.stories),
      nextCursor: null,
      groups,
    };
  }

  async create(userId: string, body: CreateStoryBody): Promise<Story> {
    const organizerId = await this.organizerAccess.resolveOrganizerForUser(
      userId,
      body.organizerId,
    );

    const organizer = await this.prisma.organizer.findUnique({
      where: { id: organizerId },
    });
    if (!organizer) {
      throw new NotFoundException('Organizer not found');
    }
    if (!organizer.isVerified) {
      throw new ForbiddenException('Only verified organizers can publish stories');
    }

    if (body.eventId) {
      const event = await this.prisma.event.findUnique({
        where: { id: body.eventId },
        select: { id: true, organizerId: true },
      });
      if (!event || event.organizerId !== organizerId) {
        throw new BadRequestException('Story event must belong to the same organizer');
      }
    }

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + STORY_TTL_MS);

    const created = await this.prisma.story.create({
      data: {
        organizerId,
        eventId: body.eventId,
        mediaUrl: body.mediaUrl,
        mediaType: body.mediaType,
        caption: body.caption,
        createdAt,
        expiresAt,
      },
      include: { organizer: true },
    });

    return toStoryContract(created);
  }

  async remove(user: AuthenticatedUser, storyId: string): Promise<void> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, organizerId: true },
    });
    if (!story) {
      throw new NotFoundException('Story not found');
    }

    const isPlatformModerator = user.role === 'MODERATOR' || user.role === 'SUPER_ADMIN';
    if (!isPlatformModerator) {
      await this.organizerAccess.assertRole(user.id, story.organizerId, ['OWNER', 'MANAGER']);
    }

    await this.prisma.story.delete({
      where: { id: storyId },
    });
  }
}
