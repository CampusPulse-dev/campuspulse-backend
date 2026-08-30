# CampusPulse Backend - Project State

## Overview

CampusPulse API handles events, identity, attendance, and administration. The tech stack is built on **NestJS 11**, **Prisma** (PostgreSQL), and uses **Zod** for request validation.

## Modules

The application is structured into domain-driven modules inside `src/modules/`:

- **Identity (`src/modules/identity/`)**: _[IN PROGRESS]_ Handles authentication (signup/signin/logout), authorization via JWT in `httpOnly` cookies, password hashing (bcrypt), and verification flows for students/organizers.
- **Events (`src/modules/events/`)**: _[SCAFFOLD]_ Will handle event creation, RSVP logic, and story feeds.
- **Attendance (`src/modules/attendance/`)**: _[SCAFFOLD]_ Will handle check-ins (QR code/manual) and verification limits.
- **Admin (`src/modules/admin/`)**: _[SCAFFOLD]_ Will handle platform-wide administration tasks.

## Database Schema (Prisma)

The database uses PostgreSQL. Key entities include:

- `User`: Attendees, Organizers, and Super Admins.
- `Organizer`: Verified entities that host events.
- `Event`: Details about specific happenings.
- `Rsvp` & `CheckIn`: Attendance tracking.
- `VerificationRequest`: Workflow for verifying Student IDs and Organizer Club proofs.

## Current Focus

We are currently implementing the **Identity & Authentication** architecture. This includes:

1. `POST /auth/signup` - User registration.
2. `POST /auth/signin` - User login issuing a JWT in an `httpOnly` cookie.
3. `POST /auth/logout` - Clearing the JWT cookie.
4. Protecting routes with a custom `JwtAuthGuard`.

_Last updated: August 2026_
