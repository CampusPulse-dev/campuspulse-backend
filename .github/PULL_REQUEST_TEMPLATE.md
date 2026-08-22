## What & why

<!-- What changes, and what problem it solves. Link the Trello card: [S0-01] -->

Ticket: <!-- e.g. [S1-04] -->

## How to verify

<!-- Steps a reviewer can actually run. "Trust me" is not a step. -->

## Checklist

- [ ] Ticket id in the title and the branch name
- [ ] `npm run lint`, `typecheck` and `test` pass locally
- [ ] Contract changes released in `campuspulse-contract` and the version bumped here
- [ ] Schema changes ship with a migration (`prisma migrate dev`)
- [ ] No new personal data logged (student emails and ID documents are NDPA data)
- [ ] Docs or ADR updated if this changes an architectural decision

## Risk

<!-- What breaks if this is wrong, and how it would be rolled back. -->
