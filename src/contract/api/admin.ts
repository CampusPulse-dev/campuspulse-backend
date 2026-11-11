import { z } from 'zod';
import {
  AuditLogEntry,
  OrganizerPublic,
  UserPublic,
  VerificationRequest,
} from '../domain/entities';
import { UserRole } from '../domain/enums';
import { Id, IsoDateTime, Pagination, page } from '../domain/primitives';

/** A queue row as a reviewer sees it. Never carries a storage key or a document URL. */
export const AdminVerificationItem = VerificationRequest.extend({
  /** Club evidence link supplied by the applicant (ORGANIZER_CLUB only). */
  evidenceUrl: z.url().nullable(),
  /** True while a student ID image is held. Fetch it via `/document`; it is deleted on decision. */
  hasDocument: z.boolean(),
  /** When the current reviewer's 15-minute soft-lock lapses. */
  lockExpiresAt: IsoDateTime.nullable(),
  organizer: OrganizerPublic.nullable(),
  creatorHandle: z.string().nullable(),
});
export type AdminVerificationItem = z.infer<typeof AdminVerificationItem>;

export const AdminVerificationQueueResponse = page(AdminVerificationItem);
export type AdminVerificationQueueResponse = z.infer<typeof AdminVerificationQueueResponse>;

export const AdminOverview = z.object({
  /** Open (PENDING / IN_REVIEW) requests the caller's role may review. */
  pendingVerifications: z.object({
    organizerClub: z.number().int().nonnegative(),
    creatorProfile: z.number().int().nonnegative(),
    /** Null for roles that may not see the student ID queue. */
    studentId: z.number().int().nonnegative().nullable(),
  }),
  /** Null for roles without moderation access. */
  openReports: z.number().int().nonnegative().nullable(),
  oldestPendingSubmittedAt: IsoDateTime.nullable(),
  slaHours: z.number().int().positive(),
});
export type AdminOverview = z.infer<typeof AdminOverview>;

export const ReportStatus = z.enum(['OPEN', 'RESOLVED', 'DISMISSED']);
export type ReportStatus = z.infer<typeof ReportStatus>;

export const AdminReport = z.object({
  id: Id,
  reporter: UserPublic,
  targetType: z.string(),
  targetId: z.string(),
  /** Human label for the target (event title, club name…), when it still exists. */
  targetLabel: z.string().nullable(),
  reasonCategory: z.string(),
  details: z.string(),
  status: ReportStatus,
  resolutionNote: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type AdminReport = z.infer<typeof AdminReport>;

export const AdminReportsQuery = Pagination.extend({ status: ReportStatus.default('OPEN') });
export type AdminReportsQuery = z.infer<typeof AdminReportsQuery>;

export const AdminReportsResponse = page(AdminReport);
export type AdminReportsResponse = z.infer<typeof AdminReportsResponse>;

export const ResolveReportBody = z
  .object({
    action: z.enum(['DISMISS', 'UNPUBLISH_EVENT', 'REMOVE_STORY', 'SUSPEND_USER']),
    note: z.string().trim().min(1).max(1000),
    /** Required for SUSPEND_USER: the account the moderator decided to suspend. */
    userId: Id.optional(),
  })
  .refine((v) => v.action !== 'SUSPEND_USER' || v.userId !== undefined, {
    message: 'userId is required when suspending a user',
    path: ['userId'],
  });
export type ResolveReportBody = z.infer<typeof ResolveReportBody>;

export const AdminUser = z.object({
  id: Id,
  displayName: z.string(),
  /** Masked, e.g. `a***@stu.ui.edu.ng`. */
  emailHint: z.string(),
  role: UserRole,
  isVerifiedStudent: z.boolean(),
  suspendedAt: IsoDateTime.nullable(),
});
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminUsersQuery = Pagination.extend({
  /** Matches display name, or an exact email address. Sent in the body-less GET query. */
  search: z.string().trim().max(120).optional(),
  staffOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export type AdminUsersQuery = z.infer<typeof AdminUsersQuery>;

export const AdminUsersResponse = page(AdminUser);
export type AdminUsersResponse = z.infer<typeof AdminUsersResponse>;

export const UpdateUserRoleBody = z.object({ role: UserRole });
export type UpdateUserRoleBody = z.infer<typeof UpdateUserRoleBody>;

export const SetUserSuspensionBody = z.object({
  suspended: z.boolean(),
  note: z.string().trim().min(1).max(1000),
});
export type SetUserSuspensionBody = z.infer<typeof SetUserSuspensionBody>;

export const PlatformSettingEntry = z.object({
  key: z.string(),
  value: z.unknown(),
  updatedAt: IsoDateTime,
});
export type PlatformSettingEntry = z.infer<typeof PlatformSettingEntry>;

export const PlatformSettingsResponse = z.object({ items: z.array(PlatformSettingEntry) });
export type PlatformSettingsResponse = z.infer<typeof PlatformSettingsResponse>;

export const PutPlatformSettingBody = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_.]{1,63}$/, 'key must be lower_snake.dotted'),
  value: z.union([
    z.string().max(2000),
    z.number(),
    z.boolean(),
    z.array(z.string().max(200)).max(50),
  ]),
});
export type PutPlatformSettingBody = z.infer<typeof PutPlatformSettingBody>;

export const AuditLogQuery = Pagination.extend({
  actorId: Id.optional(),
  targetType: z.string().max(80).optional(),
  targetId: z.string().max(120).optional(),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuery>;

export const AuditLogResponse = page(AuditLogEntry);
export type AuditLogResponse = z.infer<typeof AuditLogResponse>;
