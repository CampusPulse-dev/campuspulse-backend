-- CreateEnum
CREATE TYPE "OrganizerTeamRole" AS ENUM ('OWNER', 'MANAGER');

-- CreateEnum
CREATE TYPE "EventTemplate" AS ENUM ('GENERIC', 'CONCERT_PARTY', 'PLAY_CULTURAL', 'MATCH_TOURNAMENT', 'DINNER_GALA', 'TALK_WORKSHOP');

-- CreateEnum
CREATE TYPE "TonightMood" AS ENUM ('CHILL', 'TURN_UP', 'LEARN', 'WATCH_GAME');

-- CreateEnum
CREATE TYPE "EventLinkType" AS ENUM ('AFTER_PARTY', 'SERIES_CHILD');

-- CreateEnum
CREATE TYPE "AfterPartyAccessRule" AS ENUM ('OPEN', 'PRIORITY_CHECKED_IN', 'CHECKED_IN_ONLY');

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "FollowTargetType" AS ENUM ('ORGANIZER', 'CREATOR', 'VENDOR');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('REMINDER', 'EVENT_CRITICAL', 'FOLLOWED_POST', 'SOCIAL_FRIEND', 'RECOMMENDATION', 'SYSTEM_VERIFICATION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'CREATOR';
ALTER TYPE "UserRole" ADD VALUE 'VERIFIER';
ALTER TYPE "UserRole" ADD VALUE 'MODERATOR';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VerificationSubject" ADD VALUE 'CREATOR_PROFILE';
ALTER TYPE "VerificationSubject" ADD VALUE 'VENDOR_CLAIM';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "afterPartyAccess" "AfterPartyAccessRule" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "checkInCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "doorPolicy" TEXT,
ADD COLUMN     "dressCode" TEXT,
ADD COLUMN     "linkType" "EventLinkType",
ADD COLUMN     "parentEventId" UUID,
ADD COLUMN     "parentLinkApproved" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "studentsOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "template" "EventTemplate" NOT NULL DEFAULT 'GENERIC',
ADD COLUMN     "tonightMood" "TonightMood",
ADD COLUMN     "waitlistEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "whatsappGroupUrl" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "category" "NotificationCategory" NOT NULL DEFAULT 'REMINDER';

-- AlterTable
ALTER TABLE "Rsvp" ADD COLUMN     "ambassadorLinkId" UUID,
ADD COLUMN     "hideFromFriends" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inviteId" UUID,
ADD COLUMN     "showtimeId" UUID;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "faculty" TEXT,
ADD COLUMN     "hall" TEXT,
ADD COLUMN     "hideFromFriends" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "level" TEXT,
ADD COLUMN     "phoneHash" TEXT,
ADD COLUMN     "refreshTokenHash" TEXT,
ADD COLUMN     "rsvpVisibility" TEXT NOT NULL DEFAULT 'FRIENDS',
ADD COLUMN     "theme" TEXT NOT NULL DEFAULT 'system';

-- CreateTable
CREATE TABLE "PersonaProfile" (
    "userId" UUID NOT NULL,
    "interestTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "goingOutRhythm" TEXT NOT NULL DEFAULT 'BOTH',
    "freeOnly" BOOLEAN NOT NULL DEFAULT true,
    "personaLabel" TEXT NOT NULL DEFAULT '',
    "skippedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonaProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "OrganizerMember" (
    "organizerId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "OrganizerTeamRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizerMember_pkey" PRIMARY KEY ("organizerId","userId")
);

-- CreateTable
CREATE TABLE "DoorStaffGrant" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "grantedById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoorStaffGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "instagramUrl" TEXT,
    "tiktokUrl" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "followerCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorFollow" (
    "userId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorFollow_pkey" PRIMARY KEY ("userId","creatorId")
);

-- CreateTable
CREATE TABLE "EventShowtime" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "capacity" INTEGER,
    "rsvpCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EventShowtime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLineupItem" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "roleType" TEXT NOT NULL DEFAULT 'LINEUP',
    "displayName" TEXT NOT NULL,
    "roleLabel" TEXT NOT NULL DEFAULT '',
    "setTime" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "creatorId" UUID,
    "vendorId" UUID,

    CONSTRAINT "EventLineupItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventFixture" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "homeTeamName" TEXT NOT NULL,
    "awayTeamName" TEXT NOT NULL,
    "homeScore" INTEGER NOT NULL DEFAULT 0,
    "awayScore" INTEGER NOT NULL DEFAULT 0,
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "statusLabel" TEXT NOT NULL DEFAULT 'Scheduled',

    CONSTRAINT "EventFixture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventInterest" (
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventInterest_pkey" PRIMARY KEY ("eventId","userId")
);

-- CreateTable
CREATE TABLE "Friendship" (
    "id" UUID NOT NULL,
    "requesterId" UUID NOT NULL,
    "addresseeId" UUID NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventInvite" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "inviterId" UUID NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "acceptedByUserId" UUID,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbassadorLink" (
    "id" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "rsvpCount" INTEGER NOT NULL DEFAULT 0,
    "checkInCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmbassadorLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationReport" (
    "id" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reasonCategory" TEXT NOT NULL DEFAULT 'GENERAL',
    "details" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedById" UUID,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" UUID NOT NULL,
    "mutedCategories" "NotificationCategory"[] DEFAULT ARRAY[]::"NotificationCategory"[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "OrganizerMember_userId_idx" ON "OrganizerMember"("userId");

-- CreateIndex
CREATE INDEX "DoorStaffGrant_userId_expiresAt_idx" ON "DoorStaffGrant"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DoorStaffGrant_eventId_userId_key" ON "DoorStaffGrant"("eventId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_userId_key" ON "CreatorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_handle_key" ON "CreatorProfile"("handle");

-- CreateIndex
CREATE INDEX "CreatorFollow_creatorId_idx" ON "CreatorFollow"("creatorId");

-- CreateIndex
CREATE INDEX "EventShowtime_eventId_startsAt_idx" ON "EventShowtime"("eventId", "startsAt");

-- CreateIndex
CREATE INDEX "EventLineupItem_eventId_sortOrder_idx" ON "EventLineupItem"("eventId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "EventFixture_eventId_key" ON "EventFixture"("eventId");

-- CreateIndex
CREATE INDEX "EventInterest_userId_createdAt_idx" ON "EventInterest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Friendship_addresseeId_status_idx" ON "Friendship"("addresseeId", "status");

-- CreateIndex
CREATE INDEX "Friendship_requesterId_status_idx" ON "Friendship"("requesterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_requesterId_addresseeId_key" ON "Friendship"("requesterId", "addresseeId");

-- CreateIndex
CREATE UNIQUE INDEX "EventInvite_inviteCode_key" ON "EventInvite"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "AmbassadorLink_code_key" ON "AmbassadorLink"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AmbassadorLink_creatorId_eventId_key" ON "AmbassadorLink"("creatorId", "eventId");

-- CreateIndex
CREATE INDEX "ModerationReport_status_createdAt_idx" ON "ModerationReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "Event_parentEventId_idx" ON "Event"("parentEventId");

-- CreateIndex
CREATE INDEX "Rsvp_eventId_status_createdAt_idx" ON "Rsvp"("eventId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "User_hall_faculty_idx" ON "User"("hall", "faculty");

-- AddForeignKey
ALTER TABLE "PersonaProfile" ADD CONSTRAINT "PersonaProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizerMember" ADD CONSTRAINT "OrganizerMember_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizerMember" ADD CONSTRAINT "OrganizerMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoorStaffGrant" ADD CONSTRAINT "DoorStaffGrant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoorStaffGrant" ADD CONSTRAINT "DoorStaffGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoorStaffGrant" ADD CONSTRAINT "DoorStaffGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorFollow" ADD CONSTRAINT "CreatorFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorFollow" ADD CONSTRAINT "CreatorFollow_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_parentEventId_fkey" FOREIGN KEY ("parentEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventShowtime" ADD CONSTRAINT "EventShowtime_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLineupItem" ADD CONSTRAINT "EventLineupItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLineupItem" ADD CONSTRAINT "EventLineupItem_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventFixture" ADD CONSTRAINT "EventFixture_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rsvp" ADD CONSTRAINT "Rsvp_showtimeId_fkey" FOREIGN KEY ("showtimeId") REFERENCES "EventShowtime"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rsvp" ADD CONSTRAINT "Rsvp_ambassadorLinkId_fkey" FOREIGN KEY ("ambassadorLinkId") REFERENCES "AmbassadorLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rsvp" ADD CONSTRAINT "Rsvp_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "EventInvite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInterest" ADD CONSTRAINT "EventInterest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInterest" ADD CONSTRAINT "EventInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbassadorLink" ADD CONSTRAINT "AmbassadorLink_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbassadorLink" ADD CONSTRAINT "AmbassadorLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationReport" ADD CONSTRAINT "ModerationReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationReport" ADD CONSTRAINT "ModerationReport_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformSetting" ADD CONSTRAINT "PlatformSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
