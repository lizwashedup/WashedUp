# Critical database contract audit, 2026-08-16

## Bottom line

The audited baseline contained exactly 191 SQL migrations. This private build currently adds five REVIEW ONLY migrations, bringing the local total to 196. They cover atomic payout claims, future function privileges, accepted-relationship DMs, Circle trust edges, and bounded chat paging. The directory is not a reproducible database baseline. The baseline files create 66 tables, while core objects including `profiles`, `events`, `event_members`, `ticket_orders`, `ticket_payouts`, `organizer_receivables`, `user_roles`, and the verification-code tables are referenced without a local `CREATE TABLE`. A full replay from an empty PostgreSQL database cannot prove production equivalence.

The one duplicate migration version is exact:

* `20260813200000_event_members_anon_read_rls_fix.sql`
* `20260813200000_notify_report_restore_auth_header.sql`

Do not rename either file yet. A rename can cause an old, superseded notification function to be treated as a new pending migration and overwrite the run-token implementation. First establish which intent is represented by the live `supabase_migrations.schema_migrations` row and fingerprint the live event-member policy and notification function. No production query was made in this audit.

## Replay classification

All 191 baseline files were scanned after separating top-level SQL, function bodies, and `DO` blocks. Fifty-six baseline files contain at least one tracked side effect or state-dependent operation. The new default-function-privilege migration adds one more state-dependent file, so the current classified union is 57. This inventory is not a replay-safety verdict. It records top-level data mutation, fixture mutation inside a `DO` block, scheduler mutation, irreversible table removal, unguarded constraint replacement, or default privilege changes. Many files will fail transactionally or repeat an idempotent upsert. Any replay still belongs only in an isolated database with transport disabled.

### Top-level scheduler mutation, 6

* `20260504220000_albums_v1_cron.sql`
* `20260506100000_albums_morning_pt_timing.sql`
* `20260516120000_albums_cover_and_archive.sql`
* `20260518230000_waitlist_exceptions_expiry_cron.sql`
* `20260707120000_event_chat_model.sql`
* `20260814140100_schedule_release_expired_ticket_holds.sql`

### Top-level data mutation, 21

* `20260323000000_launch_party_unlimited_capacity.sql`
* `20260327000001_add_end_time_to_plans.sql`
* `20260330000000_remove_symmetric_friend_rows.sql`
* `20260401000000_fix_full_status_bugs.sql`
* `20260406200000_plan_albums.sql`
* `20260407000000_*`
* `20260407100000_update_mark_descriptions_and_icons.sql`
* `20260411000000_add_welcome_seen_to_profiles.sql`
* `20260504210000_albums_v1_schema.sql`
* `20260506130000_marketing_media_bucket.sql`
* `20260525000000_chat_phase1_voice_messages.sql`
* `20260611000400_circle_covers_bucket_limit.sql`
* `20260705120000_community_media_bucket.sql`
* `20260706100500_join_flow.sql`
* `20260707120000_event_chat_model.sql`
* `20260707200000_intro_blurb.sql`
* `20260813104957_office_finance_seed_data.sql`
* `20260813104958_office_tools_seed_data.sql`
* `20260813231609_block_non_us_signups.sql`
* `20260814130000_ticket_inbox_failed_state_and_event_ordering.sql`
* `20260814151000_one_reaction_per_person_v2.sql`

### Fixture or self-test mutation inside `DO`, 29

* `20260608000100_decline_soft.sql`
* `20260608000200_accept_block_check.sql`
* `20260608000300_incoming_requests_context_line.sql`
* `20260608000400_people_request_notif_copy.sql`
* `20260608000500_notif_one_line.sql`
* `20260608000600_decline_block_guard.sql`
* `20260611000000_add_or_accept_person.sql`
* `20260611000100_interest_signal_reshow_fix.sql`
* `20260611000200_update_circle_clear_cover.sql`
* `20260611000300_get_circle_detail_data.sql`
* `20260611000500_plan_feedback_fine_and_upsert.sql`
* `20260611000600_survey_plan_type_facts.sql`
* `20260611000700_review_ask_eligibility.sql`
* `20260611000800_survey_keep_state.sql`
* `20260614000100_report_no_show_rpc.sql`
* `20260702184012_communities_skeleton.sql`
* `20260702190455_operator_applications.sql`
* `20260706100500_join_flow.sql`
* `20260706150000_mvp_batch.sql`
* `20260707120000_event_chat_model.sql`
* `20260707200000_intro_blurb.sql`
* `20260708200000_templates_and_drafts.sql`
* `20260708220000_open_composer.sql`
* `20260712035429_fix_batch_28_s1_s2_s3_s5.sql`
* `20260713224144_organizer_profile_proposal_36.sql`
* `20260714052620_leader_card_proposal_41.sql`
* `20260714223943_answers_withhold_proposal_42.sql`
* `20260716000100_first_join_prompts_and_area_wishlists.sql`
* `20260716233736_participation_notice_evidence_proposal_49.sql`

Two of those `DO` blocks also mutate scheduler state: `20260516120000_albums_cover_and_archive.sql` and `20260712035429_fix_batch_28_s1_s2_s3_s5.sql`.

### Irreversible object removal, 1

* `20260504200000_drop_album_v0.sql`, drops `public.plan_photos CASCADE`.

### Unguarded constraint replacement, 8

* `20260430190000_messages_reply_fk_set_null.sql`
* `20260430210000_admin_fks_set_null.sql`
* `20260611000500_plan_feedback_fine_and_upsert.sql`
* `20260702190455_operator_applications.sql`
* `20260706100500_join_flow.sql`
* `20260706150000_mvp_batch.sql`
* `20260708220000_open_composer.sql`
* `20260814120000_ticket_payouts_payout_id_shared_per_organizer.sql`

The baseline category lists overlap. Their union is 56 files. The new default privilege category brings the current union to 57.

## Account deletion and Vault conclusions

`20260815120000_user_deletion_fk_gap.sql` adds the correct direct `auth.users(id) ON DELETE CASCADE` constraints for `user_roles.user_id`, `email_verification_codes.user_id`, and `sms_verification_codes.user_id`. Both self-serve edge functions call `auth.admin.deleteUser(user.id)`, and the latest tracked `delete_own_account` function directly deletes the same auth row. Static source still cannot prove every live user reference is covered because the live schema is incomplete in git.

`organizer_receivables.organizer_user_id` must remain unchanged and must not gain CASCADE, SET NULL, or cleanup behavior until Liz rules. No local migration defines that table, so a synthetic survival row would prove only the fixture. The private suite must record this path as blocked, not verified.

`20260815120100_notify_tokens_to_vault.sql` proves only that two Vault secrets are present and nonempty. It cannot prove they match the edge-function secrets. The known live mismatch therefore remains outside what SQL can certify. The migration correctly avoids embedding token values, but both trigger functions swallow all errors, so mismatch remains silent. The harness must report cross-plane token equality as BLOCKED, never PASS, until a coordinated finish or revert is authorized.

## Private implementation status

1. `scripts/db-contracts/static-contracts.mjs` now inventories all migration files, fingerprints the complete inventory, rejects duplicate versions, checks the explicit side-effect classifications, rejects new known secret-shaped literals, checks the latest Vault notification bodies, rejects executable `organizer_receivables` changes, and fails on unresolved provenance. The one legacy exception is bound to its exact file, fingerprint, and occurrence count. This is detection of known token shapes, not proof that no committed secret exists.

2. `scripts/db-contracts/migration-contracts.json` records the full inventory digest and every one of the 57 explicit side-effect or state-dependent files. Files outside that union are treated as definition-only only while the count and inventory digest match. The legacy album webhook token is recorded only by SHA-256 fingerprint and remains a separate rotation item.

3. Add `docs/database/migration-provenance.json`. Initially mark version `20260813200000` unresolved and both local candidates. The static command must fail while unresolved. After an authorized read-only production inspection, record the migration row and object fingerprints. Then either archive the superseded notification file outside `supabase/migrations`, or issue a new unique migration for whichever intent is absent. Do not mechanically rename the notification file.

4. `00_account_deletion_fixture.sql` and `01_account_deletion_contract.sql` prove the exact three new cascades and their supporting indexes in an isolated PostgreSQL database. They deliberately do not synthesize missing legal, audit, or receivable tables, so those survivor rules remain unverified from local source.

5. `30_default_privileges_fixture.sql` and `31_default_privileges_contract.sql` prove that the REVIEW ONLY default-privilege migration leaves existing ACLs unchanged, removes untrusted execution from future functions owned by either database owner, and preserves service-role execution. The global PUBLIC revocation applies to future functions in every schema for both owners, while the direct anon and authenticated revocations are scoped to `public`. Future migrations must explicitly grant intended callers. Live authority and compatibility still require approval before apply.

6. `10_refund_fixture.sql` and `11_refund_two_session_contract.sql` prove two-session refund claim locking and keyed release. The payout helper binds reconciliation to both payout id and connected-account snapshot. Missing account identity now alerts and refuses to update, but a real stored connected-account payout payload still needs authorized shape verification before deploy. The REVIEW ONLY batch-claim migration and its PostgreSQL contract prove complete fresh claims, rollback on a sibling conflict, failed-row reclaim, duplicate rejection, and one complete concurrent winner. A crash after the database claim but before the Stripe request remains a separate recovery-policy gap. The private suite does not claim checkout, refund totals, receivable consumption, or complete payout safety.

7. `20_vault_fixture.sql` and `21_vault_contract.sql` stub Vault and `net.http_post` with no network, prove missing-secret rejection, preserve both triggers, and capture fixture authorization headers. They prove the database half only.

8. `supabase/functions/_shared/runTokenAuth.ts` is used by both notification functions. Its Deno contract covers exact match and rejection cases without loading either transport-bearing handler or making a network call.

9. `scripts/db-contracts/run-private-sql-contracts.sh` requires an already-present PostgreSQL image, uses `--pull never`, `--rm`, and `--network none`, mounts only the exact contract directory and five required migration files, and uses the exact captured container ID for execution and cleanup. It runs static diagnostics first, continues the safe isolated database proofs, then returns the combined release-gate result. Deno edge contracts run through the package QA command instead of from the PostgreSQL container.

10. Package commands `test:db:static` and `test:db:private` exist. Neither has been added to metered CI.

## Static proof versus PostgreSQL proof

Static checks can prove the migration count, version uniqueness, classification coverage, detection of the configured known token shapes, exact source-level FK declarations, authorization check order, and that tracked executable SQL does not modify organizer receivables. They cannot prove the absence of every possible committed secret.

Isolated PostgreSQL is required to prove cascade behavior, FK validation, index presence, role/default privilege behavior, trigger attachment, Vault lookup behavior, transaction rollback, lock contention, unique constraints, checkout/refund/payout idempotency, and scheduler isolation. Cross-plane equality between PostgreSQL Vault and edge-function secrets cannot be proven by either private static or isolated tests. It remains a coordinated live-state operation and is explicitly held.

## Commands

```sh
node scripts/db-contracts/static-contracts.mjs
sh scripts/db-contracts/run-private-sql-contracts.sh
deno test --no-remote --no-config supabase/functions/_tests/runTokenAuth_test.ts
```

The private runner must fail closed if Docker is unavailable, the PostgreSQL image is absent, any migration version is duplicated, the provenance record is unresolved, a network-capable transport is reachable, or any SQL assertion emits an exception.
