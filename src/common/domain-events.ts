export const DOMAIN_EVENTS = {
  EVENT_UPDATED: 'event.updated',
  EVENT_CANCELLED: 'event.cancelled',
  RSVP_CREATED: 'rsvp.created',
  RSVP_PROMOTED: 'rsvp.promoted',
  RSVP_CANCELLED: 'rsvp.cancelled',
  INTEREST_ADDED: 'interest.added',
  INTEREST_REMOVED: 'interest.removed',
} as const;

export interface EventUpdatedPayload {
  eventId: string;
  slug: string;
  title: string;
  previousStartsAt: string;
  startsAt: string;
  endsAt: string;
  venueName: string;
}

export interface EventCancelledPayload {
  eventId: string;
  slug: string;
  title: string;
  reason: string;
}
