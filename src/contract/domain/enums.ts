import { z } from 'zod';

/**
 * PRD §1 — five fixed categories, required at event creation.
 * These are load-bearing: check-in burst profile and verification
 * scrutiny both key off category.
 */
export const EventCategory = z.enum([
  'SOCIAL_PARTY',
  'PERFORMANCE_ARTS',
  'ACADEMIC_CONFERENCE',
  'SPORTS_RECREATION',
  'CLUB_SOCIETY',
]);
export type EventCategory = z.infer<typeof EventCategory>;

export const UserRole = z.enum([
  'ATTENDEE',
  'ORGANIZER',
  'CREATOR',
  'VERIFIER',
  'MODERATOR',
  'SUPER_ADMIN',
]);
export type UserRole = z.infer<typeof UserRole>;

export const OrganizerTeamRole = z.enum(['OWNER', 'MANAGER']);
export type OrganizerTeamRole = z.infer<typeof OrganizerTeamRole>;

export const EventStatus = z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']);
export type EventStatus = z.infer<typeof EventStatus>;

export const EventTemplate = z.enum([
  'GENERIC',
  'CONCERT_PARTY',
  'PLAY_CULTURAL',
  'MATCH_TOURNAMENT',
  'DINNER_GALA',
  'TALK_WORKSHOP',
]);
export type EventTemplate = z.infer<typeof EventTemplate>;

export const TonightMood = z.enum(['CHILL', 'TURN_UP', 'LEARN', 'WATCH_GAME']);
export type TonightMood = z.infer<typeof TonightMood>;

export const EventLinkType = z.enum(['AFTER_PARTY', 'SERIES_CHILD']);
export type EventLinkType = z.infer<typeof EventLinkType>;

export const AfterPartyAccessRule = z.enum(['OPEN', 'PRIORITY_CHECKED_IN', 'CHECKED_IN_ONLY']);
export type AfterPartyAccessRule = z.infer<typeof AfterPartyAccessRule>;

export const RsvpStatus = z.enum(['CONFIRMED', 'WAITLISTED', 'CANCELLED']);
export type RsvpStatus = z.infer<typeof RsvpStatus>;

/** PRD §6 — manual fallback is mandatory, not optional. */
export const CheckInMethod = z.enum(['QR_SCAN', 'MANUAL']);
export type CheckInMethod = z.infer<typeof CheckInMethod>;

export const FriendshipStatus = z.enum(['PENDING', 'ACCEPTED', 'BLOCKED']);
export type FriendshipStatus = z.infer<typeof FriendshipStatus>;

export const FollowTargetType = z.enum(['ORGANIZER', 'CREATOR', 'VENDOR']);
export type FollowTargetType = z.infer<typeof FollowTargetType>;

/** PRD §5 flow 3 — rejection and info-request both require a reviewer note. */
export const VerificationStatus = z.enum([
  'PENDING',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'INFO_REQUESTED',
]);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const VerificationSubject = z.enum([
  'ORGANIZER_CLUB',
  'STUDENT_ID',
  'CREATOR_PROFILE',
  'VENDOR_CLAIM',
]);
export type VerificationSubject = z.infer<typeof VerificationSubject>;

export const NotificationCategory = z.enum([
  'REMINDER',
  'EVENT_CRITICAL',
  'FOLLOWED_POST',
  'SOCIAL_FRIEND',
  'RECOMMENDATION',
  'SYSTEM_VERIFICATION',
]);
export type NotificationCategory = z.infer<typeof NotificationCategory>;

export const NotificationChannel = z.enum(['PUSH', 'IN_APP', 'EMAIL']);
export type NotificationChannel = z.infer<typeof NotificationChannel>;
