# Superseded migration artifacts

Files in this directory are preserved for audit and design recovery only. This
directory is outside `supabase/migrations`, so Supabase migration tooling does
not execute them.

## 20260813200000 notification draft

`20260813200000_notify_report_restore_auth_header.sql` is the abandoned
Authorization-header implementation that collided with the active
`20260813200000_event_members_anon_read_rls_fix.sql` version. The current
notification definitions read run tokens from Vault. This archived file must
not be restored to active inventory or used to decide the still-unresolved live
token rotation.

## Community join-policy and role-tier drafts

The following files were removed from active inventory as one incompatible
review-only chain:

- `20260819050000_community_join_policy.sql`
- `20260819060000_community_join_review_actions.sql`
- `20260821010000_community_role_tiers_enum.sql`
- `20260821020000_community_role_tiers_capabilities.sql`

The first file tries to add an enum-backed column, while the observed live
database already has `communities.join_policy` as `text NOT NULL DEFAULT
'open'`. The review-actions and role-tier drafts depend on that enum-backed
shape, and the role-tier work was split across two files. Keeping only part of
the chain active would leave a partial feature.

The compatible, isolated replacement for the join-policy boundary is
`../review-only/community-join-policy-existing-text.sql`. It preserves the live
text column, does not alter the five existing rows, and does not change the
default. Its private contracts live in
`supabase/tests/contracts/90_community_join_policy_fixture.sql` and
`supabase/tests/contracts/91_community_join_policy_contract.sql`.

The review-actions and role-tier capability work remains preserved here, but
requires a new text-compatible decomposition and dedicated contracts before it
can become a release candidate. No file in this directory is approved for
production.

## Event-member identity-marks trigger draft

`20260824190000_fix_event_members_identity_marks_trigger_auth_gap.sql` is
preserved here because its migration-time self-test selected existing profiles
and created transient application rows in the target database. The safe,
forward-only replacement is
`../../migrations/20260824212000_fix_event_members_identity_marks_trigger_safe.sql`.
It defines the internal helper and trigger from source control but performs only
catalog verification during migration. The behavioral proof runs with
disposable identities in `supabase/tests/contracts/111_release_blockers_contract.sql`.

## Circle suggestion drafts

`20260605000000_circle_suggestions_detection.sql` and
`20260823090100_schedule_circle_suggestions_detection.sql` were removed from
active migration inventory together. The first file labels itself review-only,
while the second schedules it. Leaving that pair executable would activate the
older detector before the privacy, current-eligibility, and exact-roster fixes
in `../review-only/circle-suggestions-v2.sql` are approved. The hardened v2
proposal remains non-executable, and its presentation and dismissal behavior
remain Liz approval gates. No Circle cron change occurred in production.
