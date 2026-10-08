# Chat and push release — October 8, 2026

Liz authorized getting the prepared changes out on October 8. This supersedes the
previous deployment hold for this combined chat/push candidate. It does not
approve unrelated redesign features, native changes, Android delivery, messages
to users, or changes to the protected historical release branch.

## Candidate and scope

- App source: `6b1ea800dc8849e56755a354154f0c02343fe9dc`.
- Feature branch: `feature/chat-push-candidate-20261007`.
- Main observed: `d7bdb9a8a4f1e648bd2309c10db8408e5062ff99`.
- Production iOS channel maps to the production branch and is not paused.
- Current iOS update group: `a8b9fb8b-5fd5-432a-95dc-9d2560318e63`;
  update `01a11565-639d-7078-95e9-c943eb154eae`, source `d7bdb9a`.
- Verified Build 51 runtime: `2c21d65e4f9b6bad5e9823bc1886f6c3bb773ed1`.
- No native inputs changed. Android has no verified target for this release.

## Database package

`20261008120000_private_chat_block_boundary.sql` promotes the two previously
review-only files into one transaction. The six restrictive policies and nine
source-fingerprint-guarded routine patches apply together or roll back together.
Existing messages and memberships remain stored. The additive
`20261007130000_push_registration_state.sql` supplies push diagnostics.

The operator package applies only these exact two migrations, records their exact
source in `supabase_migrations.schema_migrations`, verifies ACL/RLS and helper
fingerprints, and uses bounded lock/statement timeouts. It never runs the entire
historical pending-migration inventory. Both new objects and migration versions
must be absent before applying; an uncertain response requires catalog inspection,
not a blind retry.

Fresh production catalog inspection matches all nine reviewed routines. The exact
combined operator package succeeded against production in a transaction ending
in ROLLBACK. The final SELECT confirmed no candidate objects or migration records
remained (`dry_run_rollback_clean = true`). This is compatibility evidence, not a
deployment or proof of device behavior.

## Verification

- 278 isolated SQL assertions pass, including whole-migration failure atomicity,
  exact-definition rollback, every message/membership row preserved, retained push
  telemetry, and successful reapplication.
- The complete existing Docker private-database contract gate passes using the
  existing Lima VM and a byte-for-byte source snapshot in its permitted mount.
- The production rollback-only dry run passes.
- Existing app-source evidence: 31 latest inbox tests, 14 local Realtime checks,
  TypeScript and iOS export pass; earlier changed-suite run was 47 suites/1,263 tests.
- The earlier process-isolated full Jest inventory had 26 non-passing suites;
  all reproduced on unchanged main. The fresh legacy aggregate gate is being run;
  do not call the complete regression lock green based on scoped results.

The full native traceability gate requires the real sibling web/admin repositories.
The old Desktop siblings contain unrelated local changes/missing files and were
not repaired or overwritten. Verification uses a separate exact native-source
snapshot alongside the intact Documents siblings. No test expectations are changed
or failures suppressed to obtain a release result.

## Recovery

App rollback: republish the verified previous iOS group, explicitly selecting iOS:

```sh
eas update:republish --group a8b9fb8b-5fd5-432a-95dc-9d2560318e63 --destination-branch production --platform ios --message "Restore previous Build 51 update" --non-interactive
```

Backend protections can stay deployed if only the app is rolled back. Emergency
backend reversal is separately available in
`docs/database/review-only/20261008120000_private_chat_block_boundary.rollback.sql`.
It refuses newer routine source and restores the exact originals without deleting
messages, memberships or diagnostic data. It removes the new blocking protection;
do not use it for unrelated issues. A production reversal must be recorded as a
new forward migration, preserving existing migration history.

## Remaining evidence and limits

Native keyboard/clipboard App Hanging events remain unresolved. No monitoring or
native text-input behavior was disabled to mask them. Exact-update phone testing,
post-deployment catalog/provider verification and the final release result are
recorded below when completed. No WhatsApp-equivalent reliability guarantee is made.

Evidence directory:
`/Users/liz/Desktop/WashedUp_HQ/chat-verification-20261007/evidence/release-20261008`.
