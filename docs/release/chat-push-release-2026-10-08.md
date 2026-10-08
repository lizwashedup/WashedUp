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
  all reproduced on unchanged main. The fresh legacy aggregate gate remains failed/incomplete;
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

## Deployed backend checkpoint — 23:38 UTC / 4:38 PM PDT

Both exact migrations committed successfully to WashedUp App production project
`upstjumasqblszevlgik`. Versions `20261007130000` and `20261008120000` are recorded
with their exact SQL source. No historical migrations were applied or rewritten.

Fresh post-deployment comparison verified all nine patched function fingerprints,
preserved authenticated/anonymous execute grants, all previous policies unchanged,
and all six new policies restrictive. The production phone-signup canary passed
and returned `rollback_clean = true`; no synthetic account was retained. This is
signup database-chain proof, not an SMS/OTP delivery test.

The exact deployment package SHA256 is
`723887ce5d3279415bbb0a920d9617de365db7f37cecb449df5d0f2d3fba99e6`.
Evidence: `deployment-result.json`, `post-deploy-catalog.json`, and
`post-deploy-signup-canary.json` in the evidence directory above.

Chrome's signed-in Sentry page was inspected after deployment: project react-native,
all environments, no text/status restriction, last one hour, sorted Last Seen.
It displayed “No issues match your search.” This short observation is not proof
of error-free active use or resolution of the earlier native keyboard hangs.
No Sentry settings/issues were changed.

## App publication status

[PR #16](https://github.com/lizwashedup/WashedUp/pull/16) contains the combined
candidate and release package. No merge, iOS OTA, Android update, or native build
has been performed in this pass. Production remains on the previous verified
update group listed above.

The full Docker private-database gate now passes. The aggregate `qa:all` attempt
also passed consent/signup database contracts, complete native/sibling evidence
traceability and TypeScript before its Jest runner failed and stalled. Four
reported suites were rerun in separate processes and all passed (72 tests):
AndroidReactionJourney (6), useTopicChat.intros (18), ReportModal.lifetime (24),
and useTopicComposerDraft (24). The stuck aggregate process was stopped after
about five minutes; its incomplete inventory is not a pass. The earlier complete
process-isolated inventory and its unchanged-main failure comparison remain the
broader evidence. No tests or application behavior were altered to hide failures.

A release-choice question is pending: repair the mandatory aggregate gate before
public OTA, or obtain an explicit limited-rollout exception for the documented
failures. iPhone Mirroring reported iPhone in Use; a separate lock/nearby request
is pending. Exact-candidate phone testing has not occurred. Existing baseline
hangs, physical-device proof and full regression certification remain open.

The remaining non-aggregate gate commands were executed explicitly and passed:
`qa:confirmations`, `qa:notifications`, `qa:payouts`, `qa:ticketing`,
`qa:deliverability:local`, `qa:consent-sync:local`, `test:db:static`,
`qa:migration-inventory`, and `qa:migration-drift`. This records their results
without presenting the interrupted all-in-one command as successful.

The existing Lima VM was initially stopped. It was started solely for verification;
test containers were removed by the contract runner. The retained integration
containers/data were not deleted. The VM is returned to its stopped state after
verification. The isolated source snapshot is retained for a reproducible follow-up.
