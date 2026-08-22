import { z } from 'zod';

/** Every non-2xx response from the API uses this shape. */
export const ApiError = z.object({
  statusCode: z.number().int(),
  code: z.string(),
  message: z.string(),
  /** Field-level detail for validation failures. */
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  requestId: z.string(),
});
export type ApiError = z.infer<typeof ApiError>;

export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  EVENT_FULL: 'EVENT_FULL',
  ALREADY_RSVPD: 'ALREADY_RSVPD',
  EVENT_CANCELLED: 'EVENT_CANCELLED',
  QR_SIGNATURE_INVALID: 'QR_SIGNATURE_INVALID',
  ORGANIZER_NOT_VERIFIED: 'ORGANIZER_NOT_VERIFIED',
  VERIFICATION_CLAIMED: 'VERIFICATION_CLAIMED',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
