# Yours rebuild — before-apply checklist (migrations 20260517*)

These migrations are **review only**. Nothing has been applied. Supabase
preview branches are broken for this repo, so apply directly + rely on each
file's trailing self-test (it RAISEs and rolls back the BEGIN/COMMIT on any
failed assertion).

## Reconcile against prod first (Supabase MCP, project upstjumasqblszevlgik)

Already verified 2026-05-16 (re-confirm if time has passed):

- [ ] `app_notifications` columns still: user_id, type, title, body,
      event_id, status, actor_user_id (5/6 inserts assume these).
- [ ] `app_notifications_type_check` value list — 5/6 preserves the 18
      values seen on 2026-05-16. If new types shipped since, union them
      into the `ADD CONSTRAINT` array before applying.
- [ ] `on_app_notification_inserted` AFTER INSERT trigger still fans rows
      to the protected push edge fn (so inserts alone deliver push).
- [ ] `event_status` enum still has `completed`; `member_status` has
      `joined`; events have `end_time`.
- [ ] Block model unchanged: `user_blocks(blocker_id,blocked_id)` +
      legacy `profiles.blocked_users uuid[]`.
- [ ] Albums: `plan_albums(event_id,archived_at)` +
      `album_uploads(plan_album_id,thumbnail_url,display_url,media_url,deleted_at,created_at)`.
- [ ] `pgcrypto` still in `extensions` schema (5/6 calls
      `extensions.digest`).

## Apply order (each is transactional + self-tested)

1. `20260517000000_yours_tables.sql`
2. `20260517000100_yours_helpers.sql`
3. `20260517000200_yours_read_rpcs.sql`
4. `20260517000300_yours_mutation_rpcs.sql`
5. `20260517000400_yours_push_triggers.sql`
6. `20260517000600_resolve_referral_code.sql` (QR same-app-scan resolve;
   depends only on `profiles.referral_code` from migration 000)

Migrations 1-5 + 6 are additive and safe to ship **ahead of** flipping the
flag (no existing behavior depends on them).

## Gated (DO NOT apply until flip)

7. `20260517000500_GATED_archive_friends_pinned_people.sql` — destructive
   (renames `friends`/`pinned_people` to `*_archived_20260517`). Has a
   leading guard DO-block that RAISEs on accidental apply. Apply **only**
   when flipping `YOURS_PAGE_ENABLED=true` in a shipped build, after
   removing the guard block by hand. Per spec there is intentionally no
   backfill (fresh start is the upgrade moment).

## Client phone-hash contract (referral)

`useReferral` sends SHA-256 hex (lowercase) of the E.164 phone. The
signup trigger recomputes `encode(extensions.digest(phone_number,'sha256'),'hex')`.
Confirm `profiles.phone_number` is stored in the exact E.164 form the
client hashes.
