import { z } from 'zod';
import { UserPublic, OrganizerPublic, VerificationRequest } from '../domain/entities';
import { VerificationStatus, VerificationSubject } from '../domain/enums';
import { Id, Pagination, Slug, StudentEmail, page } from '../domain/primitives';

export const SignUpBody = z.object({
  email: z.email(),
  password: z.string().min(10).max(200),
  displayName: z.string().min(1).max(80),
});
export type SignUpBody = z.infer<typeof SignUpBody>;

export const SignInBody = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type SignInBody = z.infer<typeof SignInBody>;

export const SessionResponse = z.object({
  user: UserPublic,
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type SessionResponse = z.infer<typeof SessionResponse>;

export const SubmitStudentVerificationBody = z.object({
  studentEmail: StudentEmail,
  /** Opaque handle from the upload endpoint — never a public URL. */
  documentUploadId: z.string().min(1),
});
export type SubmitStudentVerificationBody = z.infer<typeof SubmitStudentVerificationBody>;

export const SubmitOrganizerVerificationBody = z.object({
  organizerName: z.string().min(1).max(120),
  slug: Slug,
  evidenceUrl: z.url(),
  note: z.string().max(1000).nullable().default(null),
});
export type SubmitOrganizerVerificationBody = z.infer<typeof SubmitOrganizerVerificationBody>;

export const VerificationQueueQuery = Pagination.extend({
  subject: VerificationSubject.optional(),
  status: VerificationStatus.optional(),
});
export type VerificationQueueQuery = z.infer<typeof VerificationQueueQuery>;

export const VerificationQueueResponse = page(VerificationRequest);
export type VerificationQueueResponse = z.infer<typeof VerificationQueueResponse>;

/**
 * Rejection and info-request require a note; approval does not.
 * Enforced here so both sides agree without a round trip.
 */
export const DecideVerificationBody = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED', 'INFO_REQUESTED']),
    note: z.string().max(1000).nullable().default(null),
  })
  .refine((v) => v.decision === 'APPROVED' || (v.note !== null && v.note.trim().length > 0), {
    message: 'a note is required when rejecting or requesting more information',
    path: ['note'],
  });
export type DecideVerificationBody = z.infer<typeof DecideVerificationBody>;

export const FollowOrganizerResponse = z.object({
  organizerId: Id,
  following: z.boolean(),
  followerCount: z.number().int().nonnegative(),
});
export type FollowOrganizerResponse = z.infer<typeof FollowOrganizerResponse>;

export const FollowCreatorResponse = z.object({
  creatorId: Id,
  following: z.boolean(),
  followerCount: z.number().int().nonnegative(),
});
export type FollowCreatorResponse = z.infer<typeof FollowCreatorResponse>;

export const OrganizerListResponse = page(OrganizerPublic);
export type OrganizerListResponse = z.infer<typeof OrganizerListResponse>;
