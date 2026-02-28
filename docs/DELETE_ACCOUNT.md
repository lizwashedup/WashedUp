# Account Deletion

Account deletion is handled by Lovable:

- **delete_own_account() RPC** — SECURITY DEFINER function that cascades through all user data (events, messages, memberships, friends, reports, wishlists, etc.) and removes the auth identity via `auth.admin_delete_user()`. No Edge Function needed.

The Profile page calls `supabase.rpc('delete_own_account')` then signs the user out. App Store compliant.
