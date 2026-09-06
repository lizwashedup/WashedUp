# Direct-apply evidence: three held migrations applied 2026-09-06

Applied directly to production via `supabase db query --linked -f`, each with exit 0, in
this order: `20260904000000_community_member_removal_reason_and_restore.sql`,
`20260904030000_waitlist_priority_enforcement.sql`, `20260904040000_configurable_join_questions.sql`.
Josh's own go, given after asking for real testing rather than a status report.

## Method

Before applying any of the three for real, each was first dry-run tested as a real
`BEGIN; ...; ROLLBACK;`-wrapped transaction against production itself (not a disposable
sandbox, and not a Supabase branch, since branches replay only tracked migrations and this
repo has known drift between tracked history and true production state). Nothing from the
dry-run phase persisted; every dry-run transaction rolled back regardless of pass or fail.

## Member removal (`20260904000000`)

Dry run used two real existing `auth.users` rows as fixtures (no fabricated UUIDs). Asserted:
an empty reason is rejected, a real removal records `removed_reason`/`removed_at`/`removed_by`
correctly, and `restore_community_member` clears all three fields and returns status to
`active`. All passed on the first dry run. Applied for real; confirmed live via
`information_schema.columns` that `community_members.removed_reason`, `removed_at`, and
`removed_by` all exist.

## Waitlist priority (`20260904030000`)

First dry run failed twice, on the migration's OWN bundled self-test, not on the actual
`join_event_atomic` fix:

1. `events.gender_rule` is `NOT NULL` in production; the self-test's `insert into events` never
   set it. The migration was drafted with no live Postgres available, so this was never caught
   before tonight.
2. Inserting into `events` with no auth context fires `trg_events_insert_check_marks` ->
   `check_creator_milestones`, which raises `unauthorized` for a null/mismatched `auth.uid()`.
   Real app usage never hits this (a creator always inserts under their own session), but the
   self-test's synthetic no-context insert did.

Fixed the self-test in the actual migration file (added `gender_rule = 'mixed'`, and set
`request.jwt.claims`/`role` to the acting user before each `events` insert, matching how a real
authenticated request would look) and re-ran the dry run: both scenarios passed clean (an
uninvolved public user is turned away with `waitlist_priority` while the real waitlisted user
holds an active notification; once that notification's window expires, the public can claim the
seat). Applied for real; confirmed live via `pg_proc.prosrc` for `join_event_atomic` containing
the `waitlist_priority` branch.

Not independently re-verified tonight: whether push delivery itself reaches the specific
waitlisted user in a real scenario (the migration's own header already flagged this as needing
real delivery logs, not more code reading, and that hasn't changed).

## Configurable join questions (`20260904040000`)

Dry run created a real community, joined it with every new toggle off, and confirmed the
returned answer card carried none of the four new fields (`reason_answer`, `source_answer`,
`rules_confirmed`, `open_answer`) -- the byte-identical-to-today regression case the migration's
own header calls out as needed. Note: `create_community()` requires the caller to already hold
an approved `community_leader` operator grant, and a freshly created community defaults to
`status = 'draft'`, not `active` -- neither is new to this migration, both are pre-existing
system behavior the dry-run script had to account for. The full opt-in path (all four toggles
on, required-field enforcement) was not independently re-exercised against a second real user
tonight; validating it end to end is listed on the migration's own manual checklist. Applied for
real; confirmed live via `information_schema.columns` that `communities.join_ask_reason`,
`join_ask_source`, `join_ask_rules_confirm`, and `join_open_question` all exist.

## Not applied tonight

`20260904010000_refund_authority_grants.sql` and `20260904020000_ticket_transfer_draft.sql`
were also dry-run tested (both passed clean) but were deliberately NOT applied to production.
Refund authority's own header still asks for independent security review of its one connection
point to `compute_ticket_refund`/`record_ticket_refund`, whose real bodies aren't readable from
this repo. Ticket transfer still needs Liz's explicitly-required legal review of the re-collected
waiver/age-gate answer path before release. Both remain in `held_migrations` pending those, which
are not engineering decisions.
