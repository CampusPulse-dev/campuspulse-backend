# campuspulse-backend

The CampusPulse API — events, identity, attendance and admin.

NestJS · TypeScript · PostgreSQL (Prisma) · Redis · Docker
Deployed to [Render](https://render.com) (Frankfurt). Stack rationale: [ADR 0001](docs/adr/0001-tech-stack.md).

## Quick start

```bash
git clone https://github.com/CampusPulse-dev/campuspulse-backend.git
cd campuspulse-backend
npm ci
cp .env.example .env          # then fill in the two secrets
npm run db:up                 # Postgres + Redis via Docker
npx prisma migrate dev        # create the schema
npm run dev
```

The API listens on `http://localhost:3001`, prefixed `/api/v1`.
Swagger UI is at `http://localhost:3001/docs` outside production.

Generate the two secrets with `openssl rand -base64 48`. Boot fails
immediately and loudly if anything in `.env` is missing or too short —
see [`src/config/env.ts`](src/config/env.ts).

## Layout

```
src/
├── contract/        Zod schemas — the source of truth for the API shape
├── config/          environment schema, validated at boot
├── common/          Prisma, guards, filters, audit — shared across modules
├── modules/
│   ├── events/      events, feed, stories          — Bayo
│   ├── identity/    auth, accounts, verification   — Victor
│   ├── attendance/  RSVP, check-in, notifications  — Batman
│   └── admin/       super admin portal, audit log
└── health/          liveness and readiness probes
prisma/schema.prisma the data model
```

Module boundaries are ownership boundaries. Reach across one through its
exported service, never by importing another module's internals.

## The API contract

The Zod schemas in [`src/contract`](src/contract) are the single source of
truth for every shape this API accepts and returns. The API validates
requests with them via `ZodValidationPipe`, and
[`src/openapi.ts`](src/openapi.ts) converts them into the
`components.schemas` of [`openapi.json`](openapi.json), which is committed.

`campuspulse-frontend` generates its TypeScript types from that file, so a
schema change that breaks the frontend fails the frontend's build.

**If you change a schema or a route, regenerate the spec:**

```bash
npm run openapi        # rewrites openapi.json
```

CI runs `npm run openapi:check`, which regenerates and fails if the result
differs from what you committed. Forgetting this is the one way to leave
the frontend building against a stale contract.

New shapes must be exported from `src/contract` to appear in the spec —
[`src/contract/registry.ts`](src/contract/registry.ts) collects them. A
schema that is not registered does not exist as far as the frontend is
concerned.

## Commands

| Command                     | What it does                 |
| --------------------------- | ---------------------------- |
| `npm run dev`               | Watch mode                   |
| `npm run build`             | Compile to `dist/`           |
| `npm run lint` / `lint:fix` | ESLint                       |
| `npm run typecheck`         | `tsc --noEmit`               |
| `npm test` / `test:cov`     | Unit tests                   |
| `npm run test:e2e`          | End-to-end tests             |
| `npm run db:up` / `db:down` | Local Postgres + Redis       |
| `npm run db:migrate`        | Create and apply a migration |
| `npm run db:studio`         | Prisma Studio                |

## Conventions

**Branches:** `<type>/<ticket>-<slug>` — `feat/S1-04-qr-scanner`.

**Commits:** Conventional Commits with an enforced scope, checked by a
`commit-msg` hook.

```
feat(attendance): sign RSVP QR tokens with a rotating secret
fix(events): keep feed keyset stable for equal start times
```

Scopes: `events`, `identity`, `attendance`, `admin`, `health`, `contract`,
`db`, `ci`, `docker`, `deps`, `config`, `docs`.

**Git hooks** (Husky, installed by `npm ci`):

| Hook         | Runs                                |
| ------------ | ----------------------------------- |
| `pre-commit` | `lint-staged` + debug-leftover scan |
| `commit-msg` | commitlint                          |
| `pre-push`   | typecheck + unit tests              |

The pre-commit scan blocks `debugger`, focused tests (`.only`), and any
`TODO`/`FIXME` without a ticket reference — write `// TODO(S1-04): …`.
Use `--no-verify` only when you can say why.

## Data protection

Student emails and government ID photos are personal data under the
Nigeria Data Protection Act from day one.

- Request bodies are **never** logged — Pino redacts them globally.
- ID documents are stored by key, served through short-lived
  non-downloadable views, and deleted the moment a decision is recorded.
- Every ID view is written to `AuditLog`.

If you add an endpoint that touches either, it needs an audit write.

## CI/CD

| Workflow       | Trigger          | Does                                               |
| -------------- | ---------------- | -------------------------------------------------- |
| `ci.yml`       | PR, push to main | Lint, types, format, tests, build, migration drift |
| `security.yml` | PR, push, weekly | CodeQL, gitleaks, `npm audit`                      |
| `docker.yml`   | PR, push, tags   | Builds the image; publishes to GHCR on push        |
| `release.yml`  | `v*.*.*` tag     | Changelog from conventional commits                |
| `deploy.yml`   | Manual           | Render deploy hook, then a health smoke test       |

Deploys are manual by design — `render.yaml` sets `autoDeploy: false` so a
green `main` does not reach students mid-event. Migrations run as Render's
`preDeployCommand`.

The **migration drift** job is the one worth knowing about: it fails if
`schema.prisma` was edited without a matching migration, which otherwise
only surfaces at deploy time.
