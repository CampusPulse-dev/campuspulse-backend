-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('SOCIAL_PARTY', 'PERFORMANCE_ARTS', 'ACADEMIC_CONFERENCE', 'SPORTS_RECREATION', 'CLUB_SOCIETY');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ATTENDEE', 'ORGANIZER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RsvpStatus" AS ENUM ('CONFIRMED', 'WAITLISTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('QR_SCAN', 'MANUAL');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'INFO_REQUESTED');

-- CreateEnum
CREATE TYPE "VerificationSubject" AS ENUM ('ORGANIZER_CLUB', 'STUDENT_ID');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'ATTENDEE',
    "isVerifiedStudent" BOOLEAN NOT NULL DEFAULT false,
    "studentEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organizer" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bio" TEXT,
    "logoUrl" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" UUID NOT NULL,
    "followerCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organizer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "EventCategory" NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "venueName" TEXT NOT NULL,
    "venueDetail" TEXT,
    "coverImageUrl" TEXT,
    "capacity" INTEGER,
    "rsvpCount" INTEGER NOT NULL DEFAULT 0,
    "cancelReason" TEXT,
    "organizerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Story" (
    "id" UUID NOT NULL,
    "organizerId" UUID NOT NULL,
    "eventId" UUID,
    "mediaUrl" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rsvp" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "RsvpStatus" NOT NULL DEFAULT 'CONFIRMED',
    "qrToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rsvp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "rsvpId" UUID,
    "method" "CheckInMethod" NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedInById" UUID NOT NULL,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "userId" UUID NOT NULL,
    "organizerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("userId","organizerId")
);

-- CreateTable
CREATE TABLE "VerificationRequest" (
    "id" UUID NOT NULL,
    "subject" "VerificationSubject" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedById" UUID,
    "claimedAt" TIMESTAMP(3),
    "reviewerNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "documentKey" TEXT,
    "evidenceUrl" TEXT,

    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_studentEmail_key" ON "User"("studentEmail");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Organizer_slug_key" ON "Organizer"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Organizer_ownerId_key" ON "Organizer"("ownerId");

-- CreateIndex
CREATE INDEX "Organizer_isVerified_idx" ON "Organizer"("isVerified");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE INDEX "Event_status_category_startsAt_idx" ON "Event"("status", "category", "startsAt");

-- CreateIndex
CREATE INDEX "Event_organizerId_startsAt_idx" ON "Event"("organizerId", "startsAt");

-- CreateIndex
CREATE INDEX "Story_expiresAt_idx" ON "Story"("expiresAt");

-- CreateIndex
CREATE INDEX "Story_organizerId_createdAt_idx" ON "Story"("organizerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rsvp_qrToken_key" ON "Rsvp"("qrToken");

-- CreateIndex
CREATE INDEX "Rsvp_userId_createdAt_idx" ON "Rsvp"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rsvp_eventId_userId_key" ON "Rsvp"("eventId", "userId");

-- CreateIndex
CREATE INDEX "CheckIn_eventId_checkedInAt_idx" ON "CheckIn"("eventId", "checkedInAt");

-- CreateIndex
CREATE INDEX "CheckIn_rsvpId_idx" ON "CheckIn"("rsvpId");

-- CreateIndex
CREATE INDEX "Follow_organizerId_idx" ON "Follow"("organizerId");

-- CreateIndex
CREATE INDEX "VerificationRequest_status_subject_submittedAt_idx" ON "VerificationRequest"("status", "subject", "submittedAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Organizer" ADD CONSTRAINT "Organizer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rsvp" ADD CONSTRAINT "Rsvp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rsvp" ADD CONSTRAINT "Rsvp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "Rsvp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

