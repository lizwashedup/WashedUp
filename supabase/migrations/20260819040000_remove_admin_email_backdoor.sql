-- ============================================================================
-- remove the hardcoded-email admin backdoor.
--
-- Live today, confirmed 2026-08-19: is_admin(uuid) is ONLY ever
--   select exists(select 1 from auth.users where id=user_id and email='liz@washedup.app')
-- -- a second, unauditable admin path alongside the real role-based
-- has_role(uid, 'admin'::app_role) check that most policies already OR it
-- with. Confirmed live the same day that Liz's real account already carries
-- a proper has_role admin row, so this hardcoded path grants her nothing
-- she does not already have through the real role table -- it is pure
-- downside: a bare string that breaks silently if her email ever changes,
-- and a second unaudited way into every policy that calls is_admin().
--
-- Fix: redefine is_admin(uuid) to just delegate to the real role check.
-- Same name, same argument, same return type, so every existing policy
-- that calls is_admin(uid) keeps working with zero code changes anywhere
-- else -- this migration is the whole fix. Liz keeps full admin access
-- because her has_role row is what now (and already did) authorize her.
--
-- NOT applied anywhere -- written 2026-08-19, needs a separate go-ahead
-- since it changes what "admin" resolves to across every policy that
-- calls is_admin(), all at once, live.
-- ============================================================================

create or replace function public.is_admin(user_id uuid)
returns boolean
language sql
security definer
set search_path to 'public'
as $$
  select public.has_role(user_id, 'admin'::app_role);
$$;
