Adds the Resend transport, isolated real-storage privacy coverage, initial-to-current migration rehearsal and reproducible k6/browser fixtures for S6. Production requires configured Resend; local tests retain memory delivery. Email retries preserve idempotency and sanitize provider failures.

Depends on https://github.com/CampusPulse-dev/campuspulse-backend/pull/35 (base `feat/S5-01-management-contracts`). Migration files and production deployment controls are unchanged. Rehearsal and destructive cleanup accept only dedicated disposable databases; staging and development data are not reset.

Validation: typecheck, lint, focused adapter tests and complete unit suite run locally; real PostgreSQL/Redis/MinIO suites, migration upgrade and k6 results run in CI. Exact commit/run results are appended after execution. Engineering controls and unresolved findings are in `docs/s6-engineering-controls.md`.

Release gates remain open: staging origins/Resend configuration are unavailable, Android physical acceptance is pending handoff, and CodeQL's optional-auth finding needs resolution. No production promotion or formal NDPA approval is claimed.
