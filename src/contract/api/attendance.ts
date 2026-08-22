import { z } from 'zod';
import { CheckInMethod } from '../domain/enums';
import { CheckIn, Rsvp } from '../domain/entities';
import { Id, IsoDateTime } from '../domain/primitives';

export const CreateRsvpBody = z.object({ eventId: Id });
export type CreateRsvpBody = z.infer<typeof CreateRsvpBody>;

export const CreateRsvpResponse = Rsvp;
export type CreateRsvpResponse = z.infer<typeof CreateRsvpResponse>;

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
