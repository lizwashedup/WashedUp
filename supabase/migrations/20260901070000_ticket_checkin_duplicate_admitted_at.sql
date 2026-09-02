-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
--
-- ticket_checkin_duplicate_admitted_at (2026-09-01)
--
-- Screen 30 gap (specs/washedup-BUILD35-SCREENS29-30-TRANSFER-AND-CHECKIN-20260901.md
-- section 2): a duplicate ticket scan already correctly blocks re-admission
-- (record_ticket_checkin's row lock + existence check is genuinely idempotent,
-- re-verified live in production before writing this), but the function never
-- looked up or returned the original admitted scan's timestamp, so the door
-- app could only say "already checked in" instead of "already in, at 8:47pm."
--
-- Fix: grow record_ticket_checkin's return from bare `text` to a small jsonb
-- envelope `{result, admitted_at}`. Shape GROWTH, not a shape change --
-- `result` still carries the exact same three values a caller had before
-- ('admitted' | 'duplicate' | 'voided'); `admitted_at` is new and is only
-- non-null on the 'duplicate' branch. Every other line of the live function
-- body is preserved byte-for-byte (confirmed via a live, read-only
-- pg_get_functiondef against production, project upstjumasqblszevlgik,
-- 2026-09-01) -- only the return type, one new declared variable, one new
-- lookup inside the existing 'duplicate' branch, and the final return
-- statement changed.
--
-- Correction versus the source spec doc: that doc's proposed fix says
-- "select created_at from ticket_checkins" -- the live ticket_checkins table
-- has no created_at column (confirmed via information_schema against
-- production). The real timestamp column is `scanned_at`; this migration
-- uses that.
--
-- Caller note (checked before writing this, not guessed): repos/WashedUp's
-- lib/ticketDoor.ts is the only real caller of this RPC today.
-- repos/washedup-web has no check-in surface at all yet (confirmed by grep --
-- no call to record_ticket_checkin exists there), so there is no second live
-- caller to break. ticketDoor.ts has been updated in this same batch to read
-- the new {result, admitted_at} jsonb shape, with a defensive fallback that
-- still reads a bare-string legacy response correctly (a mobile rollout can
-- leave some installed app builds on the old client code for a while after
-- this migration ships, unlike a web deploy) -- see lib/ticketDoor.ts's
-- parseCheckinPayload. Apply this migration only once that native release is
-- out, or accept that pre-upgrade app builds will simply never see the new
-- admitted_at (they still get a correct plain 'duplicate'/'admitted'/'voided'
-- outcome either way, via the same defensive parse).
--
-- ROUND 2 CORRECTION (2026-09-01), before this was ever applied: the version
-- above used bare `create or replace function ... returns jsonb` to replace a
-- live function whose own header just above says production currently
-- returns `text`. Postgres refuses that outright -- CREATE OR REPLACE cannot
-- change an existing function's return type. Reproduced for real on a
-- throwaway postgres:17-alpine container (NOT this or any WashedUp database,
-- nothing applied anywhere): a minimal function taken from text to jsonb via
-- naive CREATE OR REPLACE fails with the exact error Postgres gives here --
-- `ERROR: cannot change return type of existing function` / `HINT: Use DROP
-- FUNCTION t1(text) first.` -- so this migration would have hard-failed the
-- instant it was applied.
--
-- Fix: DROP FUNCTION IF EXISTS immediately before the CREATE OR REPLACE
-- below. That same repro also proved the second, easy-to-miss half of this:
-- DROP FUNCTION silently discards every privilege previously GRANTed on the
-- function, no error or warning -- a role granted EXECUTE before the drop
-- showed zero rows in information_schema.role_routine_grants immediately
-- after DROP FUNCTION + CREATE OR REPLACE. On this database that loss is
-- real, not cosmetic: 20260816121000_revoke_unsafe_default_function_execute.sql
-- already set ALTER DEFAULT PRIVILEGES for both the postgres and
-- supabase_admin roles so any function created from here forward gets
-- EXECUTE revoked from PUBLIC/anon/authenticated by default and granted only
-- to service_role. Without an explicit re-grant below, this RPC would go
-- live uncallable by the exact `authenticated` role lib/ticketDoor.ts calls
-- it as (supabase.rpc from a signed-in organizer's session) -- failing
-- closed with a bare Postgres permission error instead of ever reaching this
-- function's own friendly 'not authenticated' / 'not this event''s
-- organizer' checks.
--
-- The GRANT below targets `authenticated` only, matching this codebase's own
-- convention for an organizer-scoped RPC called directly by a signed-in app
-- session (see `GRANT EXECUTE ON FUNCTION public.is_event_organizer(uuid) TO
-- authenticated;` in 20260813200000_event_members_anon_read_rls_fix.sql) --
-- not `anon`, since every path through this function requires a real
-- auth.uid(). Flagged honestly rather than guessed past: this session had no
-- live Supabase connection (attempted, the MCP server was not connected), so
-- the exact grantee list record_ticket_checkin carries in production right
-- now was not directly re-confirmed the way this file's other production
-- facts above were verified. `authenticated` is inferred from the
-- codebase's own established pattern for this exact function shape, not
-- read off the live ACL -- re-verify the live grants once a Supabase
-- connection is available, before this migration is applied.
--
-- DROP FUNCTION is not on the destructive-operation list this repo's release
-- gate checks (scripts/release/migration-policy.mjs scans only for DROP
-- TABLE, DROP SCHEMA, DROP TYPE, TRUNCATE, ALTER TABLE ... DROP COLUMN, and a
-- WHERE-less DELETE), so this correction still passes that gate untouched --
-- confirmed by reading that script, not assumed.
--
-- File path note: this migration was found renamed from
-- 20260901060000_ticket_checkin_duplicate_admitted_at.sql to this file's
-- current 20260901070000 timestamp partway through this session (a
-- concurrent batch claimed 20260901060000 for
-- 20260901060000_fix_ambiguous_title_link_to_explore_event.sql instead); the
-- content carried over byte-for-byte and this fix was applied at the file's
-- real, current path.

drop function if exists public.record_ticket_checkin(text);

create or replace function public.record_ticket_checkin(p_reference_code text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_pos record;
  v_result text;
  v_admitted_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  -- row-lock the position so a double scan serializes deterministically
  select p.id, p.voided_at, o.event_id, o.status as order_status into v_pos
  from public.ticket_order_positions p
  join public.ticket_orders o on o.id = p.order_id
  where p.reference_code = upper(p_reference_code)
  for update of p;
  if not found then
    raise exception 'unknown reference';
  end if;
  if not public.is_ticketing_organizer(v_pos.event_id, v_uid) then
    raise exception 'not this event''s organizer';
  end if;
  if v_pos.voided_at is not null or v_pos.order_status <> 'paid' then
    v_result := 'voided';
  elsif exists (
    select 1 from public.ticket_checkins c
    where c.position_id = v_pos.id and c.result = 'admitted'
  ) then
    v_result := 'duplicate';
    -- new: the earliest admitted scan for this seat, so the door app can show
    -- staff when it was first checked in instead of a bare "already in"
    select c.scanned_at into v_admitted_at
    from public.ticket_checkins c
    where c.position_id = v_pos.id and c.result = 'admitted'
    order by c.scanned_at asc
    limit 1;
  else
    v_result := 'admitted';
  end if;
  insert into public.ticket_checkins (position_id, event_id, result, scanned_by_user_id)
  values (v_pos.id, v_pos.event_id, v_result, v_uid);
  return jsonb_build_object('result', v_result, 'admitted_at', v_admitted_at);
end;
$function$;

grant execute on function public.record_ticket_checkin(text) to authenticated;
