import { z } from 'zod';
import { EventCategory } from '../domain/enums';
import { EventPublic, Story } from '../domain/entities';
import { Id, IsoDateTime, Pagination, page } from '../domain/primitives';

/** Feed is ranked by recency and filterable by category (PRD §5 flow 1). */
export const FeedQuery = Pagination.extend({
  category: EventCategory.optional(),
  from: IsoDateTime.optional(),
});
export type FeedQuery = z.infer<typeof FeedQuery>;

export const FeedResponse = page(EventPublic);
export type FeedResponse = z.infer<typeof FeedResponse>;

/** Every field is required at creation — the PRD allows no partial publishes. */
export const CreateEventBody = z.object({
  title: z.string().min(3).max(140),
  description: z.string().min(1).max(5000),
  category: EventCategory,
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
  venueName: z.string().min(1).max(200),
  venueDetail: z.string().max(500).nullable().default(null),
  coverImageUrl: z.string().url(),
  capacity: z.number().int().positive().nullable().default(null),
});
export type CreateEventBody = z.infer<typeof CreateEventBody>;

export const UpdateEventBody = CreateEventBody.partial();
export type UpdateEventBody = z.infer<typeof UpdateEventBody>;

export const CancelEventBody = z.object({
  /** Attendees are notified in-app and by email; the reason is shown to them. */
  reason: z.string().min(1).max(500),
});
export type CancelEventBody = z.infer<typeof CancelEventBody>;

export const StoriesResponse = page(Story);
export type StoriesResponse = z.infer<typeof StoriesResponse>;

export const CreateStoryBody = z.object({
  eventId: Id.nullable().default(null),
  mediaUrl: z.string().url(),
  mediaType: z.enum(['IMAGE', 'VIDEO']),
  caption: z.string().max(280).nullable().default(null),
});
export type CreateStoryBody = z.infer<typeof CreateStoryBody>;
