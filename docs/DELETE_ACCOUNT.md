# Account Deletion

Two-step process for full account removal:

1. **delete_own_account() RPC** — SECURITY DEFINER function that cascades through all user data (events, messages, memberships, friends, wishlists, etc.). Wraps `message_likes` and `chat_reads` in IF EXISTS (they may not exist in all deployments). Deletes profile last.

2. **delete-user Edge Function** — Called after RPC succeeds. Uses service role to delete the auth user via `auth.admin.deleteUser()`. Required because RPC cannot reliably delete from `auth.users` in all Supabase setups.

The Profile page: (1) calls `supabase.rpc('delete_own_account')`, (2) calls the delete-user Edge Function with the session token, (3) signs out. App Store compliant.

**Deploy:** `supabase functions deploy delete-user`
