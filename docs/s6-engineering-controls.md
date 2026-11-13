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

## Security review dispositions

Gitleaks' exact fingerprint for the `S3_SECRET_ACCESS_KEY` Render declaration is allowlisted: that entry contains only the variable name and `sync: false`, with no credential value. Full-history scanning remains enabled; no file/path rule is excluded.

Independent final review classified CodeQL alert 2 (`js/user-controlled-bypass`, PR35, `jwt-auth.guard.ts`) as a false positive. Protected guards reject a null user; supplied JWTs undergo signature verification and a live-account lookup. Development-header resolution requires validated server configuration and is forbidden in production. Authentication/configuration E2E cover a valid development email being denied when disabled. The individual alert is dismissed with that rationale recorded in GitHub; the project-wide query remains enabled. PR35 security checks are rerun after this disposition.

Final-review regressions cover cross-tab scanner/outbox preservation, hidden ID fetch/decode invalidation, draft showtime/series round trips, publication retry IDs and editable parent-link approval/cycle behavior. The backend parent-link test first failed against real PostgreSQL at329ab32 (52 passed/1 failed), then the implementation was corrected. Latest real-service results are recorded in the PR and generated release evidence.

Resend uses the documented `Idempotency-Key` send header, retained by the provider for 24 hours: https://resend.com/docs/dashboard/emails/idempotency-keys. Queue retries are bounded well inside that window. Human NDPA sign-off must also address lawful basis, notices, retention policy, processors, incident response and data-subject request handling; automated engineering tests cannot approve these organizational responsibilities.
