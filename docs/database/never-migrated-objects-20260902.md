# Never-migrated production objects (confirmed 2026-09-02)

Real production objects with zero migration-file history: they exist and work live, but no file in
`supabase/migrations/` created them. `local-baseline-replay.sh` (replays the full migration history into a
fresh disposable Postgres) breaks at file 4 of 257 (`20250225000000_add_wishlists.sql`, "relation profiles
does not exist") for exactly this reason: `profiles` was never captured as a migration.

Confirmed via `grep -rl "CREATE TABLE.*public\.<name>\b" supabase/migrations/*.sql` returning nothing, run
fresh 2026-09-02:

- `profiles`
- `events`
- `event_members`
- `ticket_orders`
- `ticket_payouts`
- `organizer_receivables`
- `user_roles`
- `email_verification_codes`
- `sms_verification_codes`
- `marks`
- `ticket_holds`
- `ticket_promo_codes`
- `ticket_tiers`
- `operator_grants` (found while building the join-policy-at-creation draft migration: `create_community()`
  calls `has_operator_grant()`, which reads this table; neither has any migration-file history either)
- `has_operator_grant()` (function, same discovery)

That's 13 tables plus 1 function, all live, all real, all completely absent from `supabase/migrations/`.

## What's NOT in this file

A full column/FK/RLS/index schema pull for the first 8 of these was run once, 2026-09-02, via a one-off
read-only introspection query Josh ran in Supabase's SQL editor and pasted back. That result lived only in
that session's conversation history and was never saved to a file before the conversation was compacted --
it no longer exists anywhere. This file intentionally does not reconstruct that detail from memory, since it
can't be verified anymore. Redo the same pull (ask Josh to run a read-only `jsonb_build_object` query
against `information_schema`/`pg_catalog` for these 14 objects and paste the result back) before writing
retroactive migration files for any of them.

## Why this matters

- `local-baseline-replay.sh` cannot be trusted end to end until this is closed -- it will always break at
  file 4.
- Anyone reasoning from "grep the migrations folder" alone will conclude these objects don't exist, aren't
  used, or are safe to change without a migration. All three are wrong.
- Writing retroactive migrations for these is real, deliberate schema-archaeology work with real risk if a
  detail is guessed wrong (wrong default, wrong constraint, wrong FK). Do it as its own scoped effort with a
  fresh schema pull, not as a rider on an unrelated fix.

## Status

Documented, not fixed. No retroactive migrations written. Not blocking anything currently shipped -- these
objects work fine in production today, this is a gap in historical record and local-replay coverage, not a
live bug.
