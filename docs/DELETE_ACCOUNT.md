# Account Deletion

Two-step process for full account removal:

1. **delete_own_account() RPC** — SECURITY DEFINER function that cascades through all user data (events, messages, memberships, friends, wishlists, etc.). Wraps `message_likes` and `chat_reads` in IF EXISTS (they may not exist in all deployments). Deletes profile last.

2. **delete-user Edge Function** — Called after RPC succeeds. Uses service role to delete the auth user via `auth.admin.deleteUser()`. Required because RPC cannot reliably delete from `auth.users` in all Supabase setups.

The Profile page: (1) calls `supabase.rpc('delete_own_account')`, (2) calls the delete-user Edge Function with the session token, (3) signs out. App Store compliant.

**Deploy:** `supabase functions deploy delete-user`

## Pending organizer payout block

Decided 2026-08-17 (CODEX_HANDOFF.md item 6): deletion is blocked, not forfeited, while `ticket_payouts` shows a payout owed to the user as an organizer that isn't yet `released`. See `supabase/migrations/20260817120000_block_delete_account_with_pending_payout.sql`. (Corrected same day, before anything was ever applied: an earlier draft checked `organizer_receivables`, which turned out to be a debt the organizer owes the platform, not a payout owed to them. See that migration's own header for the full reasoning.)

The check lives in `public.organizer_has_pending_payout(uuid)` and is enforced in three places so no deletion path can skip it:

1. A `BEFORE DELETE` trigger on `auth.users`, the real enforcement point, since every deletion path (this RPC, both edge functions, and every admin route in the sibling repos) ends in one real `DELETE FROM auth.users` against this same live project.
2. `delete_own_account()` itself, as an early guard right after the "Not authenticated" check, so the common path fails fast with a clean RPC error instead of relying on the trigger firing on its own final statement.
3. The `delete-user` Edge Function, as an explicit pre-check before it ever calls `auth.admin.deleteUser()`. GoTrue wraps internal DB errors into a generic message, so this is what guarantees the specific "pending payout" text reaches the caller on that path.

`delete-ghost-account` is not touched: its own preconditions (zero events created, zero `event_members` rows) already make a real ticket payout structurally impossible for that account.

Known gap, not fixed by this migration: `admin-manage-user`'s `delete_and_ban` action purges the same user data directly and bans the `auth.users` row instead of deleting it, so this trigger never fires for it.
