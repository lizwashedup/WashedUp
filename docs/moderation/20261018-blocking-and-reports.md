# Plan blocking and report review repair

## Behavior

A block stored in either `profiles.blocked_users` or `user_blocks` now removes the blocked guest from shared forming/full/draft plans. If the blocked person created the plan, the blocker leaves instead. The creator is never removed; completed/cancelled memberships and message evidence remain. Cleanup runs with a fixed search path and narrowly scoped definer privileges, not the blocking user's RLS permissions.

Joined-membership inserts and updates reject creator/participant block conflicts and active account holds. Both joining RPCs take the block/admission mutex before row locks. Restrictive message policies and both definer editing RPCs deny removed members and creator-blocked guests. Unblocking never silently rejoins a plan. Existing DM/group boundaries are unchanged.

Every new non-block report is persisted into `report_review_tasks`. The configured administrator receives a private in-app alert, and pending reports older than 24 hours cause a single daily aggregate escalation. A minute scheduler retries dispatch if the recipient is temporarily unavailable. Read/unread or successful email delivery never resolves a report. Existing pending reports are backfilled as tasks without changing their decisions.

`admin_get_report_review_queue()` is an administrator-only queue API. `admin_review_report(report_id, status, notes, expected_status)` requires a note, rejects stale status and records reviewer/time/audit. This release is server-side; it does not add a new dashboard screen. Existing email alerts remain in place.

Future no-show feedback enters the same report queue, without duplicating an existing matching report. A no-show requires a started, non-cancelled plan and both participant records. Concurrent repeated feedback is idempotent. New submissions cannot forge reviewed status or administrator notes. Automatic banning still has a threshold of three, but now counts distinct reporters and excludes dismissed cases and block-generated records.

## Verification

Run:

```sh
python3 scripts/db-contracts/test-plan-moderation.py /absolute/path/to/postgres/bin
node scripts/release/migration-policy.mjs
```

The PostgreSQL suite uses an empty disposable Unix-socket-only database, fictional accounts, actual exported production routine bodies, ordinary authenticated roles, mocked network/cron boundaries and two concurrent connections. It proves the original cross-user RLS failure and missing no-show routing, then checks the corrected paths, authorization, preservation, source-drift rollback and exact emergency rollback. It is not a claim to reproduce every unrelated live schema object or a phone UI test.

## Operational follow-through

The preflight found 21 pending reports and 497 historical no-show records without matching general reports. The 21 pending reports become assigned review tasks. Historical no-show feedback is not replayed automatically: doing so would manufacture new report timestamps and potentially trigger bans from old allegations. It needs a separate, evidence-based review. Neither backlog is automatically dismissed or adjudicated by this deployment.

Review cases through an authenticated administrator client using the APIs above, or authorized administrative tooling. Resolve/dismiss only after evaluating the evidence. A report is an allegation; membership alone does not prove attendance. Record account/membership actions separately in `moderation_actions`.

## Deployment and rollback

Two new forward-only migrations, `20261018220000` and `20261018221000`, are packaged in one transaction for the live rollout, with migration-history entries in that same transaction. Existing routine fingerprints reject unreviewed source drift. No production impersonation or synthetic member messages are used for testing. Verify function security, triggers, restrictive policies, queue coverage, configured recipient and scheduler after commit.

`20261018-enforcement.rollback.sql` restores the captured original routines and stops only the added scheduler/triggers/policies. It deliberately retains reports, review tasks, notifications, audit records, message evidence and already-removed memberships. It reopens the original gaps and is only for a demonstrated release regression. It does not reverse moderation actions or lift account holds.
