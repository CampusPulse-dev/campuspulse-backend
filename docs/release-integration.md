# V1 management integration [S5-01]

Management reads require an actual OWNER/MANAGER membership. Public organizer event reads continue to show only published events. Creator attribution reads derive identity from the authenticated user, never from a caller-supplied creator ID.

## Isolated integration services

Run `npx tsx scripts/test-stack.ts up`, then `npx tsx scripts/test-stack.ts migrate`, then `npx tsx scripts/test-stack.ts test`.

The Compose project `campuspulse-s6-test` uses PostgreSQL on 55432, Redis on 56379 and MinIO on 59000. It does not mount the development volumes. Both public and private synthetic-media buckets are initialized idempotently. MinIO permits its default development CORS; actual browser PUT/read is exercised by the live browser suite. Production bucket CORS must restrict access to the configured frontend origin.

The E2E cleanup helper refuses databases other than `campuspulse_test` and `campuspulse_e2e`. Never point destructive suites at a shared staging database. Migrations use `migrate deploy`, not reset or schema push. Existing migrations remain unchanged.

## Validation status

Local Docker Desktop is unavailable due to an inaccessible runtime socket. The owner requested continuing without it. Database/storage and migration evidence must come from CI or staging; no local integration pass is claimed.
