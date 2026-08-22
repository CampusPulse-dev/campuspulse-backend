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

export const UserRole = z.enum(['ATTENDEE', 'ORGANIZER', 'SUPER_ADMIN']);
export type UserRole = z.infer<typeof UserRole>;

export const EventStatus = z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']);
export type EventStatus = z.infer<typeof EventStatus>;

export const RsvpStatus = z.enum(['CONFIRMED', 'WAITLISTED', 'CANCELLED']);
export type RsvpStatus = z.infer<typeof RsvpStatus>;

/** PRD §6 — manual fallback is mandatory, not optional. */
export const CheckInMethod = z.enum(['QR_SCAN', 'MANUAL']);
export type CheckInMethod = z.infer<typeof CheckInMethod>;

/** PRD §5 flow 3 — rejection and info-request both require a reviewer note. */
export const VerificationStatus = z.enum([
  'PENDING',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'INFO_REQUESTED',
]);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const VerificationSubject = z.enum(['ORGANIZER_CLUB', 'STUDENT_ID']);
export type VerificationSubject = z.infer<typeof VerificationSubject>;

export const NotificationChannel = z.enum(['PUSH', 'IN_APP', 'EMAIL']);
export type NotificationChannel = z.infer<typeof NotificationChannel>;
