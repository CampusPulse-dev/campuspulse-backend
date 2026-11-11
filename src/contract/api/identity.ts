import { z } from 'zod';
import { UserPublic, OrganizerPublic, VerificationRequest } from '../domain/entities';
import { OrganizerTeamRole, VerificationStatus, VerificationSubject } from '../domain/enums';
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

/** OTP was accepted for delivery. Deliberately says nothing about the address. */
export const StudentOtpSentResponse = z.object({
  expiresIn: z.number().int().positive(),
  resendAfter: z.number().int().nonnegative(),
});
export type StudentOtpSentResponse = z.infer<typeof StudentOtpSentResponse>;

export const VerificationSubmittedResponse = z.object({
  id: Id,
  subject: VerificationSubject,
  status: VerificationStatus,
});
export type VerificationSubmittedResponse = z.infer<typeof VerificationSubmittedResponse>;

/** A club the signed-in user belongs to, with their role on it. */
export const OrganizerMembership = z.object({
  organizer: OrganizerPublic,
  role: OrganizerTeamRole,
  /** Latest club verification state; `APPROVED` once `organizer.isVerified`. */
  verificationStatus: VerificationStatus,
  reviewerNote: z.string().max(1000).nullable(),
});
export type OrganizerMembership = z.infer<typeof OrganizerMembership>;

export const MyOrganizersResponse = z.object({ items: z.array(OrganizerMembership) });
export type MyOrganizersResponse = z.infer<typeof MyOrganizersResponse>;

export const TeamMember = z.object({
  userId: Id,
  displayName: z.string(),
  /** Masked, e.g. `a***@stu.ui.edu.ng`. Null on the caller's own row. */
  emailHint: z.string().nullable(),
  role: OrganizerTeamRole,
});
export type TeamMember = z.infer<typeof TeamMember>;

export const TeamResponse = z.object({
  organizerId: Id,
  /** The caller's own role; only OWNER may change the team. */
  role: OrganizerTeamRole,
  members: z.array(TeamMember),
});
export type TeamResponse = z.infer<typeof TeamResponse>;

/** Owners add managers. Ownership is not transferable through this route. */
export const AddTeamMemberBody = z.object({ email: z.email().max(254) });
export type AddTeamMemberBody = z.infer<typeof AddTeamMemberBody>;

export const CreatorApplyBody = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.]{3,30}$/, 'handle must be 3-30 letters, numbers, dots or underscores'),
  displayName: z.string().trim().min(1).max(80),
  bio: z.string().trim().max(300).default(''),
  instagramUrl: z.url().max(300).nullable().default(null),
  tiktokUrl: z.url().max(300).nullable().default(null),
});
export type CreatorApplyBody = z.infer<typeof CreatorApplyBody>;
