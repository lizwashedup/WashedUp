-- ============================================================================
-- Read-only monitoring role for server-side responders (Hetzner box), so
-- those responders never need Josh's own Supabase account credential or a
-- copy of his personal access token sitting on a shared multi-tenant server.
--
-- Scope, deliberately narrow (Josh's ask 2026-08-26: "can only look, never
-- change or delete anything"):
--   - cron.job, cron.job_run_details: SELECT only (cron-watchdog.sh)
--   - pg_catalog introspection (pg_trigger/pg_class/pg_proc/pg_policies,
--     pg_get_functiondef/pg_get_triggerdef): world-readable catalog views,
--     no grant needed (drift-sentinel.sh)
--   - vault.decrypted_secrets: NOT granted directly -- this role can never
--     read a raw secret value under any query it constructs. Instead, a
--     narrow SECURITY DEFINER function returns ONLY a sha256 hash of one
--     named secret, matching secret-pair.sh's existing "value never leaves
--     the DB" doctrine (see that script's own header comment). EXECUTE on
--     this function is the only vault-adjacent grant.
--
-- This role has no grants on any public app table, cannot INSERT/UPDATE/
-- DELETE anywhere, and cannot log in without a password set separately
-- (ALTER ROLE ... PASSWORD, run ad hoc, deliberately NOT in this file --
-- never commit a real credential to a tracked migration).
-- ============================================================================

create or replace function public.get_vault_secret_hash(secret_name text)
returns text
language sql
security definer
set search_path to 'public'
as $$
  select encode(sha256(convert_to(decrypted_secret,'utf8')),'hex')
  from vault.decrypted_secrets
  where name = secret_name;
$$;

revoke all on function public.get_vault_secret_hash(text) from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'washedup_monitor_ro') then
    create role washedup_monitor_ro with login nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end
$$;

grant usage on schema cron to washedup_monitor_ro;
grant select on cron.job, cron.job_run_details to washedup_monitor_ro;
grant execute on function public.get_vault_secret_hash(text) to washedup_monitor_ro;
