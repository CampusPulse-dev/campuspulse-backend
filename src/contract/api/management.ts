import { z } from 'zod';
import { EventPublic } from '../domain/entities';
import { Id, Pagination, page } from '../domain/primitives';
import { CreateEventBody } from './events';
import { OrganizerMembership } from './identity';
import { AmbassadorLinkResponse } from './attendance';

export const ManagedEventsQuery = Pagination.extend({ cursor: Id.optional() });
export type ManagedEventsQuery = z.infer<typeof ManagedEventsQuery>;
export const ManagedEventSummary = EventPublic.extend({
  checkInCount: z.number().int().nonnegative(),
});
export type ManagedEventSummary = z.infer<typeof ManagedEventSummary>;
export const ManagedEventsResponse = page(ManagedEventSummary);
export type ManagedEventsResponse = z.infer<typeof ManagedEventsResponse>;
export const ManagedEvent = ManagedEventSummary.extend({
  draft: CreateEventBody.extend({ coverImageUrl: z.url().nullable() }),
  parentLinkApproved: z.boolean(),
});
export type ManagedEvent = z.infer<typeof ManagedEvent>;
export const OrganizerDashboardResponse = z.object({
  membership: OrganizerMembership,
  kpis: z.object({
    followers: z.number().int().nonnegative(),
    upcomingRsvps: z.number().int().nonnegative(),
    showUpRate: z.number().min(0).max(1).nullable(),
    activeStories: z.number().int().nonnegative(),
  }),
});
export type OrganizerDashboardResponse = z.infer<typeof OrganizerDashboardResponse>;
export const CreatorAmbassadorLinksResponse = z.object({
  creator: z.object({ id: Id, handle: z.string(), isVerified: z.boolean() }),
  items: z.array(AmbassadorLinkResponse.extend({ event: EventPublic })),
});
export type CreatorAmbassadorLinksResponse = z.infer<typeof CreatorAmbassadorLinksResponse>;
