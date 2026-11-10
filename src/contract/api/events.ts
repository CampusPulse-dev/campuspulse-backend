import { z } from 'zod';
import { AfterPartyAccessRule, EventCategory, EventLinkType, TonightMood } from '../domain/enums';
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

export const CreateEventLineupItem = z.object({
  performerName: z.string().min(1).max(120),
  role: z.string().min(1).max(80),
  setTime: z.string().max(40).default(''),
  creatorId: Id.nullable().optional(),
});
export type CreateEventLineupItem = z.infer<typeof CreateEventLineupItem>;

export const CreateEventShowtime = z.object({
  label: z.string().min(1).max(80),
  startsAt: IsoDateTime,
  endsAt: IsoDateTime.nullable().optional(),
  capacity: z.number().int().positive().nullable().optional(),
});
export type CreateEventShowtime = z.infer<typeof CreateEventShowtime>;

export const CreateEventFixture = z.object({
  homeTeam: z.string().min(1).max(120),
  awayTeam: z.string().min(1).max(120),
  homeScore: z.number().int().nonnegative().default(0),
  awayScore: z.number().int().nonnegative().default(0),
  isLive: z.boolean().default(false),
  periodLabel: z.string().max(80).default('Scheduled'),
});
export type CreateEventFixture = z.infer<typeof CreateEventFixture>;

/** Every core field is required at creation — template blocks are optional per template. */
export const CreateEventBody = z.object({
  organizerId: Id.optional(),
  title: z.string().min(3).max(140),
  description: z.string().min(1).max(5000),
  category: EventCategory,
  template: z.enum(['GENERIC', 'CONCERT_PARTY', 'PLAY_CULTURAL', 'MATCH_TOURNAMENT']).optional(),
  tonightMood: TonightMood.nullable().optional(),
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
  venueName: z.string().min(1).max(200),
  venueDetail: z.string().max(500).nullable().default(null),
  coverImageUrl: z.url(),
  capacity: z.number().int().positive().nullable().default(null),
  studentsOnly: z.boolean().optional(),
  waitlistEnabled: z.boolean().optional(),
  dressCode: z.string().max(200).nullable().optional(),
  doorPolicy: z.string().max(500).nullable().optional(),
  whatsappGroupUrl: z.url().nullable().optional(),
  parentEventId: Id.nullable().optional(),
  linkType: EventLinkType.nullable().optional(),
  afterPartyAccess: AfterPartyAccessRule.optional(),
  lineup: z.array(CreateEventLineupItem).optional(),
  castAndCrew: z.array(z.string().min(1).max(160)).optional(),
  showtimes: z.array(CreateEventShowtime).optional(),
  fixture: CreateEventFixture.optional(),
});
export type CreateEventBody = z.infer<typeof CreateEventBody>;

export const UpdateEventBody = CreateEventBody.partial();
export type UpdateEventBody = z.infer<typeof UpdateEventBody>;

export const UpdateFixtureBody = z.object({
  homeScore: z.number().int().nonnegative(),
  awayScore: z.number().int().nonnegative(),
  isLive: z.boolean(),
  periodLabel: z.string().min(1).max(80),
});
export type UpdateFixtureBody = z.infer<typeof UpdateFixtureBody>;

export const CancelEventBody = z.object({
  /** Attendees are notified in-app and by email; the reason is shown to them. */
  reason: z.string().min(1).max(500),
});
export type CancelEventBody = z.infer<typeof CancelEventBody>;

export const StoriesResponse = page(Story);
export type StoriesResponse = z.infer<typeof StoriesResponse>;

export const CreateStoryBody = z.object({
  eventId: Id.nullable().default(null),
  mediaUrl: z.url(),
  mediaType: z.enum(['IMAGE', 'VIDEO']),
  caption: z.string().max(280).nullable().default(null),
});
export type CreateStoryBody = z.infer<typeof CreateStoryBody>;
