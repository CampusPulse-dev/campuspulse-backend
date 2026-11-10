import { z } from 'zod';
import { EventPublic, OrganizerPublic, Rsvp, UserPublic } from '../domain/entities';
import { NotificationCategory } from '../domain/enums';
import { Id, IsoDateTime, StudentEmail } from '../domain/primitives';

/** S4 attendee interfaces; controller integration follows in S1–S3. */
export const AttendeePersona = z.object({
  skipped: z.boolean(),
  vibes: z.array(z.string().trim().min(1).max(40)).max(5),
  hall: z.string().max(80),
  faculty: z.string().max(80),
  level: z.string().max(20),
  rhythm: z.enum(['WEEKNIGHTS', 'WEEKENDS', 'BOTH']),
  freeEventsOnly: z.boolean(),
  personaBadge: z.string().max(40),
  followedClubIds: z.array(Id).max(200),
});
export const AttendeePrivacy = z.object({
  stealthRsvp: z.boolean(),
  hideFromFriends: z.boolean(),
  mutedCategories: z.array(z.string().max(40)).max(20),
  theme: z.enum(['system', 'dark', 'light']),
});
export const AttendeePreferences = z.object({
  persona: AttendeePersona.nullable(),
  privacy: AttendeePrivacy,
});
export const UpdateProfileBody = z.object({ displayName: z.string().trim().min(1).max(80) });
export const FriendEntry = z.object({
  id: Id,
  user: UserPublic,
  hall: z.string().nullable(),
  faculty: z.string().nullable(),
  status: z.enum(['SUGGESTED', 'INCOMING', 'OUTGOING', 'ACCEPTED', 'BLOCKED']),
});
export const FriendsResponse = z.object({ items: z.array(FriendEntry) });
export const FriendActionBody = z.object({
  action: z.enum(['REQUEST', 'ACCEPT', 'DECLINE', 'BLOCK']),
});
export const FriendRequestBody = z.object({
  userId: Id,
  action: z.literal('REQUEST').optional(),
});
export const AttendeeNotification = z.object({
  id: Id,
  title: z.string(),
  body: z.string(),
  /** App-relative path only, so a notification can never point off-site or at `javascript:`. */
  href: z
    .string()
    .max(500)
    .regex(/^\/(?![/\\])/, 'must be an app-relative path'),
  createdAt: IsoDateTime,
  readAt: IsoDateTime.nullable(),
});
export const NotificationsResponse = z.object({ items: z.array(AttendeeNotification) });
export const CreatorPublic = z.object({
  id: Id,
  handle: z.string(),
  displayName: z.string(),
  bio: z.string(),
  avatarUrl: z.url().nullable(),
  isVerified: z.boolean(),
  followerCount: z.number().int().nonnegative(),
  events: z.array(EventPublic),
});
export const AttendeeSearchResponse = z.object({
  events: z.array(EventPublic),
  organizers: z.array(OrganizerPublic),
});
export const AttendeeTicket = z.object({ rsvp: Rsvp, event: EventPublic });
export const YourNightGroup = z.object({
  key: z.string(),
  eventIds: z.array(Id),
});
export const AttendeeTicketsResponse = z.object({
  items: z.array(AttendeeTicket),
  yourNightGroups: z.array(YourNightGroup).optional(),
});
export const StudentOtpBody = z.object({ email: StudentEmail });
export const ConfirmStudentOtpBody = StudentOtpBody.extend({ code: z.string().regex(/^\d{6}$/) });
export const StudentVerificationState = z.object({
  status: z.enum(['NONE', 'PENDING', 'APPROVED', 'REJECTED', 'INFO_REQUESTED']),
  note: z.string().nullable(),
});
export const StudentUploadBody = z.object({
  contentType: z.enum(['image/jpeg', 'image/png']),
  size: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
});
export const StudentUploadResponse = z.object({
  uploadUrl: z.url(),
  uploadId: z.string(),
});
export const StudentIdRequestBody = z.object({ documentUploadId: z.string().min(1) });
export const PushSubscriptionBody = z.object({
  /** The server POSTs to this URL, so only https push services are accepted. */
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(64) }),
});
export const PushSubscribeResponse = z.object({
  id: Id,
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  createdAt: IsoDateTime,
});
export const ReadAllNotificationsResponse = z.object({
  updatedCount: z.number().int().nonnegative(),
});
export const UpdateNotificationPreferencesBody = z.object({
  mutedCategories: z.array(NotificationCategory).max(20),
});
export const NotificationPreferencesResponse = z.object({
  mutedCategories: z.array(NotificationCategory),
});
export const SubmitReportBody = z.object({
  eventId: Id,
  reason: z.string().trim().min(1).max(1000),
});
export const ReportSubmittedResponse = z.object({
  id: Id,
  status: z.string(),
  createdAt: IsoDateTime,
});

export type AttendeePersona = z.infer<typeof AttendeePersona>;
export type YourNightGroup = z.infer<typeof YourNightGroup>;
export type ReportSubmittedResponse = z.infer<typeof ReportSubmittedResponse>;
export type AttendeePrivacy = z.infer<typeof AttendeePrivacy>;
export type AttendeePreferences = z.infer<typeof AttendeePreferences>;
export type UpdateProfileBody = z.infer<typeof UpdateProfileBody>;
export type FriendEntry = z.infer<typeof FriendEntry>;
export type FriendsResponse = z.infer<typeof FriendsResponse>;
export type FriendActionBody = z.infer<typeof FriendActionBody>;
export type FriendRequestBody = z.infer<typeof FriendRequestBody>;
export type AttendeeNotification = z.infer<typeof AttendeeNotification>;
export type NotificationsResponse = z.infer<typeof NotificationsResponse>;
export type CreatorPublic = z.infer<typeof CreatorPublic>;
export type AttendeeSearchResponse = z.infer<typeof AttendeeSearchResponse>;
export type AttendeeTicket = z.infer<typeof AttendeeTicket>;
export type AttendeeTicketsResponse = z.infer<typeof AttendeeTicketsResponse>;
export type StudentOtpBody = z.infer<typeof StudentOtpBody>;
export type ConfirmStudentOtpBody = z.infer<typeof ConfirmStudentOtpBody>;
export type StudentVerificationState = z.infer<typeof StudentVerificationState>;
export type StudentUploadBody = z.infer<typeof StudentUploadBody>;
export type StudentUploadResponse = z.infer<typeof StudentUploadResponse>;
export type StudentIdRequestBody = z.infer<typeof StudentIdRequestBody>;
export type PushSubscriptionBody = z.infer<typeof PushSubscriptionBody>;
export type PushSubscribeResponse = z.infer<typeof PushSubscribeResponse>;
export type ReadAllNotificationsResponse = z.infer<typeof ReadAllNotificationsResponse>;
export type UpdateNotificationPreferencesBody = z.infer<typeof UpdateNotificationPreferencesBody>;
export type NotificationPreferencesResponse = z.infer<typeof NotificationPreferencesResponse>;
export type SubmitReportBody = z.infer<typeof SubmitReportBody>;
