import { z } from 'zod';
import { CheckInMethod, RsvpStatus } from '../domain/enums';
import { CheckIn, Rsvp } from '../domain/entities';
import { Id, IsoDateTime } from '../domain/primitives';

export const CreateRsvpBody = z.object({
  eventId: Id,
  showtimeId: z.string().min(1).max(64).optional(),
  ambassadorCode: z.string().trim().min(1).max(32).optional(),
  inviteCode: z.string().trim().min(1).max(32).optional(),
  hideFromFriends: z.boolean().optional(),
});
export type CreateRsvpBody = z.infer<typeof CreateRsvpBody>;

export const CreateRsvpResponse = Rsvp;
export type CreateRsvpResponse = z.infer<typeof CreateRsvpResponse>;

export const CancelRsvpResponse = z.object({
  cancelled: z.boolean(),
  promotedRsvpId: Id.nullable(),
});
export type CancelRsvpResponse = z.infer<typeof CancelRsvpResponse>;

export const InterestedResponse = z.object({
  eventId: Id,
  interested: z.boolean(),
});
export type InterestedResponse = z.infer<typeof InterestedResponse>;

export const CreateAmbassadorLinkBody = z.object({
  eventId: Id,
});
export type CreateAmbassadorLinkBody = z.infer<typeof CreateAmbassadorLinkBody>;

export const AmbassadorLinkResponse = z.object({
  id: Id,
  creatorId: Id,
  eventId: Id,
  code: z.string(),
  shareUrl: z.url(),
  clickCount: z.number().int().nonnegative(),
  rsvpCount: z.number().int().nonnegative(),
  checkInCount: z.number().int().nonnegative(),
  createdAt: IsoDateTime,
});
export type AmbassadorLinkResponse = z.infer<typeof AmbassadorLinkResponse>;

/**
 * Scanner submission. `scannedAt` is client-supplied because the scanner
 * queues locally through a backend dropout and replays on reconnect —
 * the server must not stamp replayed scans with arrival time.
 */
export const CheckInBody = z.object({
  eventId: Id,
  qrToken: z.string().min(16).optional(),
  rsvpId: Id.optional(),
  method: CheckInMethod,
  scannedAt: IsoDateTime,
});
export type CheckInBody = z.infer<typeof CheckInBody>;

export const CheckInResponse = z.object({
  checkIn: CheckIn,
  attendeeName: z.string(),
  /** True when this QR has already been presented — surfaced, not blocked. */
  duplicate: z.boolean(),
});
export type CheckInResponse = z.infer<typeof CheckInResponse>;

/** Offline replay: the scanner posts a batch when connectivity returns. */
export const CheckInBatchBody = z.object({
  checkIns: z.array(CheckInBody).min(1).max(500),
});
export type CheckInBatchBody = z.infer<typeof CheckInBatchBody>;

export const CheckInBatchResponse = z.object({
  results: z.array(CheckInResponse),
});
export type CheckInBatchResponse = z.infer<typeof CheckInBatchResponse>;

export const ScannerPackRosterItem = z.object({
  rsvpId: Id,
  displayName: z.string(),
  isVerifiedStudent: z.boolean(),
  qrTokenDigest: z.string().length(64),
  checkedInAt: IsoDateTime.nullable(),
});
export type ScannerPackRosterItem = z.infer<typeof ScannerPackRosterItem>;

export const ScannerPackResponse = z.object({
  eventId: Id,
  publicKey: z.string(),
  syncedAt: IsoDateTime,
  roster: z.array(ScannerPackRosterItem),
});
export type ScannerPackResponse = z.infer<typeof ScannerPackResponse>;

export const RosterQuery = z.object({
  format: z.enum(['json', 'csv']).default('json'),
  status: RsvpStatus.optional(),
  search: z.string().trim().max(120).optional(),
});
export type RosterQuery = z.infer<typeof RosterQuery>;

export const RosterEntry = z.object({
  rsvpId: Id,
  userId: Id,
  displayName: z.string(),
  isVerifiedStudent: z.boolean(),
  badge: z.enum(['VERIFIED_STUDENT', 'GUEST']),
  hall: z.string().nullable(),
  faculty: z.string().nullable(),
  status: RsvpStatus,
  showtimeLabel: z.string().nullable(),
  checkedIn: z.boolean(),
  checkedInAt: IsoDateTime.nullable(),
  checkInMethod: CheckInMethod.nullable(),
  createdAt: IsoDateTime,
});
export type RosterEntry = z.infer<typeof RosterEntry>;

export const RosterResponse = z.object({
  eventId: Id,
  items: z.array(RosterEntry),
});
export type RosterResponse = z.infer<typeof RosterResponse>;

export const EventStatsResponse = z.object({
  eventId: Id,
  rsvpCount: z.number().int().nonnegative(),
  checkInCount: z.number().int().nonnegative(),
  /** The north-star metric, per event. */
  conversionRate: z.number().min(0).max(1),
  duplicateScanCount: z.number().int().nonnegative(),
  manualCheckInCount: z.number().int().nonnegative(),
});
export type EventStatsResponse = z.infer<typeof EventStatsResponse>;
