# ADR 0001 — Tech stack and repository structure

- **Status:** Accepted
- **Date:** 2026-08-22
- **Ticket:** [S0-01] Finalize tech stack & repo structure
- **PRD:** §5, §6
- **Deciders:** CampusPulse engineering

## Context

The PRD specifies behaviour but deliberately defers technology to a
"Technical Architecture v1.2" companion document that was never written.
This ADR is that decision.

Constraints that actually drove the choices:

- **Six weeks, six people**, and roughly four weeks of build time left at
  the point this was decided. Phase 1 (Foundation) had already slipped.
- **Three backend engineers on three separable domains** — content,
  identity, attendance.
- **Responsive web, not native** (PRD §1). A link forwarded into a
  WhatsApp group must open the real event page.
- **Cold public event page and feed under 2.5s** (PRD §6), for users on
  Nigerian mobile networks.
- **3,000–5,000 peak concurrent**, RSVP bursts of ~200/min, one door scan
  every 1–2s.
- **NDPA obligations** on student emails and government ID photos:
  audited access, short-lived non-downloadable views, deletion on decision.

## Decisions

### Backend — NestJS + TypeScript

Chosen over Django/DRF and bare Express.

The deciding factor is that TypeScript on both sides makes the API contract
a _shared compiled artifact_ rather than a document. With three backend
engineers producing endpoints for two frontend engineers on a four-week
clock, contract drift is the most likely source of late integration
failure, and it would land during hardening week.

Nest's module system also maps cleanly onto the existing ownership split,
so the three backend engineers can work in parallel without colliding:

| Module       | Scope                         | Owner  |
| ------------ | ----------------------------- | ------ |
| `events`     | Events, feed, stories         | Bayo   |
| `identity`   | Auth, accounts, verification  | Victor |
| `attendance` | RSVP, check-in, notifications | Batman |
| `admin`      | Super Admin portal, audit     | Shared |

Django was genuinely attractive because its admin would cover part of the
Super Admin portal for free. It was rejected because the PRD's admin needs
custom behaviour anyway — reviewer soft-locks, short-lived non-downloadable
ID views — and a second language would forfeit the shared contract, which
is the larger win. Bare Express was rejected because with three engineers
building in parallel and no imposed structure, the runway gets spent
inventing conventions.

### Frontend — Next.js (App Router)

Public event pages are server-rendered. This is not a preference; it is
what makes a forwarded WhatsApp link open a real, fast, crawlable page
for a signed-out visitor within the 2.5s budget. Installable PWA with a
service worker for the offline QR ticket and the scanner's local queue,
with the PRD's acknowledged iOS caveats.

### Database — PostgreSQL (Prisma)

The domain is relational — the campus social graph, RSVP uniqueness,
capacity checks. RSVP against capacity is a transaction, not an eventual
consistency problem. Prisma gives typed queries and a real migration
history, and its schema sits next to the contract schemas as a second
source of truth that CI checks for drift.

Redis alongside it for BullMQ notification queues and rate limiting.

### Hosting — Vercel (web) + Render Frankfurt (API, Postgres, Redis)

No provider offers an African region on a plan this project can justify.
Frankfurt is a realistic ~150–200ms from Ibadan; SSR plus caching absorbs
that on the read paths that matter. Fly.io's Johannesburg region is
genuinely closer and was seriously considered, but its Postgres is
self-managed — backups and failover become the team's problem, and there
is no dedicated ops person on a six-person roster.

Render keeps API, database and Redis on one platform with one bill, which
is the lowest-ops option available.

### Repository structure — two repos, contract shared via OpenAPI

Two repositories:

- `campuspulse-backend` — this repo.
- `campuspulse-frontend` — Next.js.

A monorepo was recommended and rejected in favour of a clean
backend/frontend ownership split. A third `campuspulse-contract` package
was then built and also rejected: it kept types in sync but cost three PRs
per contract change (contract, tag, then a bump on each side).

The chosen answer keeps two repos and still catches drift. The Zod schemas
live here in [`src/contract`](../../src/contract) and are the single source
of truth — the API validates with them, and
[`src/openapi.ts`](../../src/openapi.ts) converts them into the
`components.schemas` of a generated `openapi.json`, which is committed.
The frontend runs `openapi-typescript` against that file to generate its
types.

Two checks make this trustworthy:

- **Backend CI** regenerates `openapi.json` and fails if it differs from
  the committed copy, so a schema change cannot land unpublished.
- **Frontend CI** regenerates its types from the spec and fails if they
  differ from the committed copy, so a backend change that breaks the
  frontend fails the frontend's build.

**What this costs.** The frontend gets compile-time types but not runtime
schemas, so it can no longer validate responses at the boundary the way a
shared Zod package allowed. Generated types are also less pleasant to read
than the hand-written schemas. Both were judged acceptable against removing
a whole repository and a release cycle from every contract change.

## Consequences

**Good.** Parallel work across three backend domains from day one. A
schema change that breaks the frontend fails the frontend's build rather
than a scanner at a door on launch night, with no extra repository and no
version bumps. One hosting platform for all stateful infrastructure.
Docker means local, CI and production run the same image.

**Bad.** The frontend has compile-time types but no runtime response
validation. `openapi.json` is a generated file in version control, so it
shows up in diffs and can conflict on merge. Frankfurt latency is a
permanent tax on write paths. Prisma adds a generate step to every install
and CI job.

**Revisit if:** check-in latency at a real event proves unacceptable (move
the API to Fly.io Johannesburg), or the two-repo overhead visibly slows the
team down (collapse into a monorepo, which is easier to do later than to
undo).
