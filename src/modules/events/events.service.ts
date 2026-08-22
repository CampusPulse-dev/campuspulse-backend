import { Injectable, NotFoundException } from '@nestjs/common';
import type { FeedQuery } from '../../contract';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Feed: published events only, most recent first, cursor-paginated.
   * Cursor is the event id; ordering is (startsAt, id) so the keyset stays
   * stable when two events share a start time.
   */
  async feed(query: FeedQuery) {
    const { limit, cursor, category } = query;

    const events = await this.prisma.event.findMany({
      where: {
        status: 'PUBLISHED',
        ...(category ? { category } : {}),
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { organizer: true },
    });

    const hasMore = events.length > limit;
    const items = hasMore ? events.slice(0, limit) : events;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async findBySlug(slug: string) {
    const event = await this.prisma.event.findUnique({
      where: { slug },
      include: { organizer: true },
    });
    if (!event) throw new NotFoundException(`No event with slug "${slug}"`);
    return event;
  }
}
