import { z } from 'zod';
import { EventPublic, OrganizerPublic, Rsvp, UserPublic } from '../domain/entities';
import { Id, IsoDateTime, StudentEmail } from '../domain/primitives';

/** S4 attendee interfaces; controller integration follows in S1–S3. */
export const AttendeePersona = z.object({
  skipped: z.boolean(),
  vibes: z.array(z.string()).max(5),
  hall: z.string(),
  faculty: z.string(),
  level: z.string(),
  rhythm: z.enum(['WEEKNIGHTS', 'WEEKENDS', 'BOTH']),
  freeEventsOnly: z.boolean(),
  personaBadge: z.string(),
  followedClubIds: z.array(Id),
});
export const AttendeePrivacy = z.object({
  stealthRsvp: z.boolean(),
  hideFromFriends: z.boolean(),
  mutedCategories: z.array(z.string()),
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
export const FriendRequestBody = z.object({ userId: Id });
export const AttendeeNotification = z.object({
  id: Id,
  title: z.string(),
  body: z.string(),
  href: z.string(),
  createdAt: IsoDateTime,
  readAt: IsoDateTime.nullable(),
});
export const NotificationsResponse = z.object({ items: z.array(AttendeeNotification) });
export const CreatorPublic = z.object({
  id: Id,
  handle: z.string(),
  displayName: z.string(),
  bio: z.string(),
  avatarUrl: z.string().url().nullable(),
  isVerified: z.boolean(),
  followerCount: z.number().int().nonnegative(),
  events: z.array(EventPublic),
});
export const AttendeeSearchResponse = z.object({
  events: z.array(EventPublic),
  organizers: z.array(OrganizerPublic),
});
export const AttendeeTicket = z.object({ rsvp: Rsvp, event: EventPublic });
export const AttendeeTicketsResponse = z.object({ items: z.array(AttendeeTicket) });
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
  uploadUrl: z.string().url(),
  uploadId: z.string(),
});
export const StudentIdRequestBody = z.object({ documentUploadId: z.string().min(1) });
export const PushSubscriptionBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});
export const SubmitReportBody = z.object({
  eventId: Id,
  reason: z.string().trim().min(1).max(1000),
});
