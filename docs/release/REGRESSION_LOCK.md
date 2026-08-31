# WashedUp regression lock

This gate protects the working auth and database paths before any release.

## What is mandatory

`npm run qa:all` must pass before a release is described as fixed or ready. It now includes:

- returning-user and legacy-phone-migration routing tests;
- phone parsing and country-code regression tests;
- the full `auth.users -> handle_new_user -> profiles` database contract in a production-parity PostgreSQL layout;
- static assertions for OTP mode, phone-commit verification, function search paths, and the rollback-only production canary;
- a migration policy that rejects edits to existing migration history and blocks destructive SQL in new migrations;
- all pre-existing WashedUp QA lanes.

## Remote enforcement

The GitHub workflow publishes the required check `Regression Lock / release-gate`. Protect `main` so this check is required, direct pushes are blocked, and pull requests require an approving review. Until that branch rule is enabled, the workflow is visible evidence but not an absolute merge barrier.

The native traceability manifest includes evidence paths in the private sibling repositories `washedup-web` and `washedup-world`. Local workspace QA continues to require those files. The single-repository GitHub runner explicitly defers only those external existence checks; it still validates the manifest and every WashedUp-native evidence path and runs the native behavioral suites.

## Production proof rule

Passing CI proves the candidate. A production claim also requires fresh same-release evidence:

1. deployed revision or OTA update ID;
2. controlled OTP request and verification success;
3. new-user database-chain canary success, rolled back afterward;
4. post-deploy health/log check;
5. saved timestamped evidence.

No earlier test, local test, or code inspection may be represented as proof that the current production release works.

## Database rules

- Never edit a migration that may already have run.
- Repairs are new, forward-only migrations.
- Destructive operations fail the automated gate.
- Production canaries are transactional and end in `ROLLBACK`.
- Critical function search paths, triggers, and ACLs are asserted before release.
