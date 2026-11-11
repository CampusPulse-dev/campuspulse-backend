# S6 engineering control assessment

Status: engineering evidence in progress; this is not legal or organizational NDPA approval.

| Control                   | Evidence                                                                                                            | Remaining acceptance                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Organizer least privilege | management E2E: unrelated users, door-only staff denied; owner/manager real JWT reads                               | Final CI commit                                                             |
| Creator ownership         | own links use authenticated user ID; non-owner management E2E                                                       | Final CI commit                                                             |
| Private identity storage  | real MinIO upload, anonymous 403, audited no-store admin stream, immediate decision deletion                        | Storage E2E CI                                                              |
| Deletion failure          | admin verification service unit tests reject decisions when deletion fails                                          | Covered by existing suite                                                   |
| Logging minimization      | actual Pino serialization sentinel test excludes email/query/body/password/cookie/token/OTP                         | Review deployment log sinks/retention with owner                            |
| Social privacy            | friends-discovery and review-fixes E2E cover stealth RSVPs, blocks, roster restrictions                             | Staging synthetic journey                                                   |
| Refresh credentials       | HttpOnly scoped encrypted refresh cookie; database hash; replay revokes session                                     | Existing pre-encryption cookies require sign-in again                       |
| Email                     | Resend bounded 5s request timeouts, three transient attempts, stable idempotency key; memory disabled in production | Controlled staging OTP confirmation, cancellation and venue-change delivery |
| Operations                | Manual deploy retained; explicit Ed25519/storage/email/push configuration declarations                              | Secure production values and accountable owner approval                     |
| Performance               | k6 arrival-rate harness retains production throttling and exact 10/40 race assertion                                | Passing raw results; staging corroboration                                  |

## Reproduction

Use the dedicated Compose project: `npx tsx scripts/test-stack.ts up`, `migrate`, `migration-check`, then `test`. No development volumes are mounted. `migration-check` creates and removes its own random disposable database, deploys only the initial migration, then upgrades and checks drift. All three committed migrations are unchanged.

Load: build the API, run `load-fixtures`, start `serve-live`, then `LOAD_FIXTURE=$PWD/test-results/load-fixture.json API_BASE_URL=http://localhost:3001 k6 run --summary-export test-results/k6-summary.json load/rsvp.js`. Fixtures precede measurement; account setup is excluded. Test environment has real services and development-header authentication disabled. Never publish credential fixture files or API logs. CI uploads the aggregate summary only. `dropped_iterations` and unexpected HTTP failures fail the gate; no rate limits are relaxed.

Record runner CPU/RAM, Node/k6 versions, exact source SHA, service image/source versions and runtime flags with the raw summary. A fresh CI runner is the cache/reset boundary. Local Docker is unavailable; the user requested continuing through CI. Staging origins, Resend sender and key are currently unavailable; no staging delivery or performance pass is claimed.

## Open security finding

CodeQL on PR35 flags the optional JWT/development fallback in `jwt-auth.guard.ts` as a user-controlled bypass. Protected routes subsequently reject a null user, and the development resolver is gated by validated server configuration (forbidden in production). Real JWT E2E passes and the live suite explicitly rejects a development header. The finding remains open for security review; it has not been blanket-suppressed or dismissed to obtain a green check.

Resend uses the documented `Idempotency-Key` send header, retained by the provider for 24 hours: https://resend.com/docs/dashboard/emails/idempotency-keys. Queue retries are bounded well inside that window. Human NDPA sign-off must also address lawful basis, notices, retention policy, processors, incident response and data-subject request handling; automated engineering tests cannot approve these organizational responsibilities.
