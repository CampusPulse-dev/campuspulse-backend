Adds authenticated organizer dashboard, all-status event pagination, editable event detail and own creator attribution reads. Team reads include active door grants; event statistics include real ambassador counts. Public reads retain their published-only behavior.

This PR builds on #34 and contains the existing JWT, verification, admin backend and live scanner title commits above that stack. The unrelated Auth PR #14 remains untouched.

Validation: 68 backend unit tests passed; lint, typecheck, format and Nest production build passed locally. A new JWT management E2E suite covers membership isolation, pagination, draft privacy and creator ownership. The CI test job now provisions isolated PostgreSQL 16, Redis 7 and MinIO, applies committed migrations, and runs all E2E suites.

Local Docker Desktop is unavailable and the owner requested continuing without it. Migration/database/storage execution is pending CI; this PR remains draft until that evidence is green. No production database or deployment was changed. See `docs/release-integration.md` for local reproduction and cleanup boundaries.
