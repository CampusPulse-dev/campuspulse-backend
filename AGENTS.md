# AGENTS.md — campuspulse-backend (`@campuspulse/api`)

Authoritative quick-reference for AI coding agents working inside `campuspulse-backend`. For full product, schema, and flow context, read `../docs/01-PRD-SYNTHESIS-AND-SCOPE-MATRIX.md` through `../docs/07-AI-AGENT-PLAYBOOK-AND-CONVENTIONS.md`.

## 1. Architecture & Module Boundaries

- **Stack**: NestJS 11 · TypeScript · PostgreSQL 16 (Prisma 6) · Redis 7 (BullMQ & Throttler) · Zod (`src/contract/`) · Pino.
- **Port & Prefix**: `http://localhost:3001/api/v1` (Swagger UI at `/docs` outside production).
- **Module Ownership**:
  - `src/contract/` — Single source of truth for API & domain Zod schemas.
  - `src/common/` — `PrismaService`, `AuditService`, `ZodValidationPipe`, global guards & filters.
  - `src/modules/events/` — Events, templates/blocks, after-party links, feed, stories, discovery.
  - `src/modules/identity/` — Auth, accounts, student/organizer/creator verification, team roles, friends/follows.
  - `src/modules/attendance/` — RSVP, waitlist, Ed25519/HMAC QR tokens, online & batch check-in, notifications.
  - `src/modules/admin/` — Verification soft-lock queues, ephemeral ID streaming, moderation, settings, audit logs.
- **Boundary Rule**: Never import another module's internal files directly; communicate exclusively via exported NestJS services.

## 2. Mandatory Workflows

1. **API Contract Changes**:
   - Edit/add schemas in `src/contract/` and register them in `src/contract/registry.ts`.
   - Run `npm run openapi` and commit the updated `openapi.json` (CI enforces `npm run openapi:check`).
   - Mirror enum changes between `prisma/schema.prisma` and `src/contract/domain/enums.ts`.
2. **Prisma Schema Changes**:
   - Run `npx prisma migrate dev --name <snake_case_name>` and commit the SQL migration (CI blocks migration drift).
3. **NDPA 2023 & Security**:
   - Never log `req.body`, emails, passwords, or tokens.
   - Student ID documents (`STUDENT_ID`) may only be streamed to `SUPER_ADMIN` (`Cache-Control: no-store`), must write an `AuditLog` entry on every view, and must be **deleted from storage immediately** when a decision is recorded.

## 3. Git Hooks, Commit Scopes & Verification

- **Allowed Commit Scopes (`commitlint.config.cjs`)**: `events`, `identity`, `attendance`, `admin`, `health`, `contract`, `db`, `ci`, `docker`, `deps`, `config`, `docs`.
- **TODO Rule**: Every `TODO` or `FIXME` must cite a ticket ID (`// TODO(S1-02): ...`) or `pre-commit` will reject it. No `.only` or `debugger`.
- **Pre-PR Gate**:
  ```bash
  npm run format:check && npm run lint && npm run typecheck && npm run openapi:check && npm test && npm run build
  ```
