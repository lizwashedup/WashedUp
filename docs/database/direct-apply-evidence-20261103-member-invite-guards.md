# Direct-apply evidence: member invitation acceptance guards

Applied and independently verified on **November 3, 2026 (America/Los_Angeles)** in Supabase project `upstjumasqblszevlgik`, WashedUp App / main Production.

## Authorization and exact change

Liz answered “continue” to the explicit request to apply the tested backend fix for outstanding invitations to archived communities and false success after a simultaneous ban. This authorizes that narrow production repair. It does not authorize an OTA, age/gender policy changes, test messages to ordinary members or blanket migration application.

Applied the exact transaction in `docs/database/review-only/20261103_member_invite_acceptance_guards.sql` from commit `f5c6416` through the existing signed-in Supabase SQL editor. The file SHA-256 is `a0eb76113a4bf3b33b42b8a81fd877b2c221e4cc6ddfc0ac81005e4d8f78cbb3`. Its historical REVIEW ONLY header and directory name are preserved; this record supersedes the earlier not-deployed status for this file alone. The paired `_rollback.sql` remains unexecuted in production.

The transaction replaces only `public.accept_member_invite(text,uuid)`. It checks and share-locks the community against concurrent archive, and verifies the membership upsert wrote one row before accepting the invitation. Existing draft invitations, recipient binding, bans, role/original joined_at preservation and publication-audience checks remain. No row data, schema, grants, RLS, feature flags or migration-ledger records were directly changed. No live invitation was created, previewed, accepted, canceled or sent during deployment.

## Verification

Before apply, a fresh catalog query matched all four exported function hashes and recorded their owners, privileges, SECURITY DEFINER settings and search paths. The guarded apply returned **Success. No rows returned**. A separate catalog query after commit showed:

| Routine | Before MD5 | After MD5 |
| --- | --- | --- |
| accept_member_invite | 6cb89d74e00358b966e9a6e7cb50f40b | 900fdec93c21b0677654e8bacd036e5c |
| preview_member_invite | b75dbcbb7d2b284ca822510a29a6e110 | unchanged |
| creator_page_audience_matches | 627fb80a7f47d9165a76175b98603be4 | unchanged |
| creator_page_member_eligibility_guard | 816580c9b006b1571db1673cec32cbf2 | unchanged |

Acceptance remains owned by postgres, SECURITY DEFINER, search_path `public, pg_temp`, with execute grants to postgres/authenticated/service_role and no anon grant. The other three routines retained their recorded owners, privileges and configuration. A second seven-row verification returned true for every check: exact reviewed acceptance definition, unchanged preview, unchanged audience helper, unchanged eligibility guard, enabled eligibility trigger, denied anonymous execution and retained authenticated execution.

Exported verification evidence:
`/Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/member-invite-production-verification-2026-11-03.csv`.
Machine-readable receipt: `docs/database/member-invite-guards-production-20261103.json`.

A first post-apply SELECT failed to parse because Monaco replaced only the visible ending of the previous editor text. The editor was explicitly cleared and the standalone SELECT rerun successfully. The failed query did not apply another function change; subsequent exact hash verification confirms the intended result. The final editor contains verification-only SELECT SQL, not the deployment transaction. Native screenshot saving was unavailable; the browser-rendered result and exported CSV supplied the verification evidence.

## Tests and limits

Before deployment, 65 focused client tests and TypeScript passed. An isolated network-disabled PostgreSQL 17 fixture executed the exact catalog-exported functions, reproduced both gaps, and passed the candidate's eligibility/binding/expiry/replay/history/concurrent archive/concurrent ban tests. Repeat application, exact rollback and changed-definition refusal also passed. The verified deployed function hash is identical to that tested candidate.

These are code/catalog and isolated behavioral checks, not a real two-account production invitation test, full production RLS/outbox simulation, universal deep-link check or physical-device certification. Existing communities do not gain age enforcement from this repair; their previously recorded audience-coverage limits remain. App-side viewed-invitation and recovery changes are committed locally but not released by this deployment.

## Rollback and follow-up

The guarded paired rollback restores the exact previous acceptance definition, preserving existing row data. It reintroduces both recorded bugs and must not be run automatically. No bulk `db push` or migration-ledger repair was performed; do not replay old invitation migrations over this live function.

The remaining end-to-end test is explicitly scoped to a separate private QA community and the documented App Review test account, pending Liz's approval. It should create a recipient-bound link, verify wrong-account refusal, reopen under the intended account, join once, verify the resulting membership and retained history, and confirm the normal community route. No test broadcast, ordinary-member invitation, payment or real-user ban is needed. Native Share should be opened and canceled without sending. Expiry/archive/ban races remain isolated-fixture tests rather than destructive production exercises.
