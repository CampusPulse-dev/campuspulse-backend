import { z } from 'zod';
import {
  EventCategory,
  EventStatus,
  RsvpStatus,
  CheckInMethod,
  UserRole,
  VerificationStatus,
  VerificationSubject,
} from './enums';
import { Id, IsoDateTime, Slug } from './primitives';

export const UserPublic = z.object({
  id: Id,
  displayName: z.string().min(1).max(80),
  avatarUrl: z.string().url().nullable(),
  role: UserRole,
  isVerifiedStudent: z.boolean(),
});
export type UserPublic = z.infer<typeof UserPublic>;

export const OrganizerPublic = z.object({
  id: Id,
  slug: Slug,
  name: z.string().min(1).max(120),
  bio: z.string().max(500).nullable(),
  logoUrl: z.string().url().nullable(),
  isVerified: z.boolean(),
  followerCount: z.number().int().nonnegative(),
});
export type OrganizerPublic = z.infer<typeof OrganizerPublic>;

/**
 * Shape returned by the public event page, which must render for
 * signed-out visitors arriving from a forwarded WhatsApp link (PRD §5).
 */
export const EventPublic = z.object({
  id: Id,
  slug: Slug,
  title: z.string().min(3).max(140),
  description: z.string().max(5000),
  category: EventCategory,
  status: EventStatus,
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
  venueName: z.string().min(1).max(200),
  venueDetail: z.string().max(500).nullable(),
  coverImageUrl: z.string().url().nullable(),
  capacity: z.number().int().positive().nullable(),
  rsvpCount: z.number().int().nonnegative(),
  organizer: OrganizerPublic,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type EventPublic = z.infer<typeof EventPublic>;

/** 24-hour lifetime is enforced server-side, not by the client. */
export const Story = z.object({
  id: Id,
  organizer: OrganizerPublic,
  eventId: Id.nullable(),
  mediaUrl: z.string().url(),
  mediaType: z.enum(['IMAGE', 'VIDEO']),
  caption: z.string().max(280).nullable(),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type Story = z.infer<typeof Story>;

export const Rsvp = z.object({
  id: Id,
  eventId: Id,
  userId: Id,
  status: RsvpStatus,
  /**
   * Signed QR payload (PRD §6). The client caches this so the ticket
   * renders offline; validation is a local signature check first.
   */
  qrToken: z.string().min(16),
  createdAt: IsoDateTime,
});
export type Rsvp = z.infer<typeof Rsvp>;

export const CheckIn = z.object({
  id: Id,
  eventId: Id,
  rsvpId: Id.nullable(),
  method: CheckInMethod,
  checkedInAt: IsoDateTime,
  checkedInBy: Id,
  /** Duplicate scans are logged and surfaced post-event, never blocked at the door. */
  isDuplicate: z.boolean(),
});
export type CheckIn = z.infer<typeof CheckIn>;

/**
 * Verification queue item. Note there is no document URL here — ID
 * documents are fetched through a separate short-lived, audited,
 * non-downloadable endpoint (PRD §6, NDPA).
 */
export const VerificationRequest = z.object({
  id: Id,
  subject: VerificationSubject,
  status: VerificationStatus,
  submittedBy: UserPublic,
  submittedAt: IsoDateTime,
  /** Soft-lock: set while a reviewer holds the item. */
  claimedBy: UserPublic.nullable(),
  claimedAt: IsoDateTime.nullable(),
  reviewerNote: z.string().max(1000).nullable(),
  decidedAt: IsoDateTime.nullable(),
});
export type VerificationRequest = z.infer<typeof VerificationRequest>;

export const AuditLogEntry = z.object({
  id: Id,
  actorId: Id,
  action: z.string().min(1).max(120),
  targetType: z.string().min(1).max(80),
  targetId: z.string().min(1),
  metadata: z.record(z.unknown()),
  createdAt: IsoDateTime,
});
export type AuditLogEntry = z.infer<typeof AuditLogEntry>;
