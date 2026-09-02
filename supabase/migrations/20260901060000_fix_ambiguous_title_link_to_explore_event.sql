-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
--
-- fix: ambiguous-title guessing in auto_link_explore_event (2026-09-01)
--
-- Bug: auto_link_explore_event() (trigger auto_link_explore_event_trigger,
-- BEFORE INSERT on public.events) guesses a new Plan's explore_event_id by
-- title match whenever the client leaves it null:
--
--   SELECT id INTO v_explore_id FROM explore_events
--   WHERE status = 'Live' AND lower(trim(title)) = lower(trim(NEW.title))
--   LIMIT 1;
--
-- With no ORDER BY, "LIMIT 1" over 2+ Live explore_events that share a
-- normalized title returns whichever row the planner happens to return
-- first -- nondeterministic, not "first created" or "best match". A brand
-- new Plan can end up permanently linked to the WRONG source event.
-- lib/duplicatePlan.ts already names this exact failure mode in its own
-- comment ("the tour's spawn mislink") and works around it by passing
-- explore_event_id explicitly whenever the caller already knows it
-- (duplicate flow, event-to-Plan handoff via lib/eventPlanHandoff.ts) -- but
-- any OTHER insert that leaves it null (a brand new, unrelated post whose
-- title happens to collide with 2+ Live explore_event titles) still hits
-- the trigger's guess directly, with no app-side workaround possible. A
-- wrong link surfaces to users as the "wrong plan name" symptom and,
-- combined with the Plan-side sourceEventCancelled check in
-- app/plan/[id].tsx (which reads explore_event_id back to decide whether to
-- show the "the event this was based on was cancelled" banner), most
-- plausibly also explains a stale/wrong "cancelled" banner or a "going"
-- state read against the wrong explore_events row after a cancel.
--
-- Provenance for the body captured below: confirmed live against
-- production (upstjumasqblszevlgik) tonight via pg_trigger/pg_proc, and
-- independently byte-for-byte matched against this repo's own full-schema
-- capture at ops/drift/baseline-20260825.sql (function ~line 1170, trigger
-- ~line 16271) -- two reads eight days apart agree exactly, not a single
-- unverified look. Per that capture's own ops/drift/INVENTORY-20260825.md,
-- this function and trigger have always been in the "untracked, present
-- only in the live baseline dump" bucket, and a fresh grep across
-- supabase/migrations/ tonight (before this file existed) still finds zero
-- hits for either name -- the same untracked-drift pattern already hit
-- once tonight for the community-chat-parity migration. This file is that
-- trigger's first-ever tracked migration: unlike a plain drift "reassert"
-- (compare 20260831234500_reassert_safe_event_status_milestone_trigger.sql,
-- which only ever repairs a trigger some earlier migration already
-- created), this one is written to also work on a from-scratch migration
-- replay where neither object exists yet -- see the preflight below.
--
-- The fix, and nothing more than this: only auto-link when the normalized
-- title match is UNIQUE among Live explore_events. An ambiguous (2+) match
-- now leaves explore_event_id null instead of guessing -- the same "we
-- don't know, so don't pretend we do" outcome the trigger already produces
-- today for a ZERO-match title. The single-match case (today's common,
-- correct path) is byte-for-byte unchanged. This is a correctness fix, not
-- a new product decision: it does not change which events are eligible
-- (still status = 'Live' only) and does not change the normalization
-- (still lower+trim) -- it only removes the nondeterministic guess in the
-- ambiguous case.
--
-- Explicitly OUT of scope for this migration (do not conflate): the
-- separate finding that Plan membership (event_members) and Organization/
-- Community-event RSVPs (explore_event_rsvps) are two fully independent
-- systems with their own independent cache invalidation and no
-- cross-awareness. That is a real, separate correctness question, but it
-- is a cross-system reconciliation question with no Liz decision or spec
-- describing the intended behavior once two systems disagree -- not a
-- guessing-trigger bug. Fixing THIS trigger removes the most plausible way
-- a wrong pairing gets created in the first place; it does not attempt to
-- reconcile the two systems for a pairing that already exists.
--
-- No duplicate-titled Live explore_events exist in production right now
-- (checked as part of tonight's investigation) -- this bug is real but
-- currently dormant/data-dependent, not actively firing. This migration
-- prevents recurrence; it does not change any presently-observable
-- behavior.
--
-- NOT TESTED AGAINST A REAL DATABASE. This sandbox has no local Postgres/
-- Supabase stack (no `supabase` CLI found, no reachable disposable
-- harness) to apply this against. The preflight/postflight DO blocks below
-- stand in for that: preflight allows a from-scratch replay (neither
-- object exists) straight through, refuses outright on any partial or
-- unrecognized state, and otherwise requires the LIVE function body to
-- match either the exact known-buggy text captured above or this
-- migration's own already-applied fix (idempotent re-run) before touching
-- anything -- so real drift since tonight's read fails loud instead of
-- silently overwriting something else. Postflight re-reads the result and
-- fails loud if the fix and the trigger attachment don't both look right
-- afterward. Same standing caveat as
-- 20260901050000_community_event_plan_page_routing.sql: run this against a
-- prod clone or a local harness first if one becomes available, before it
-- is ever applied for real.

begin;

do $preflight$
declare
  v_function_oid regprocedure;
  v_trigger_count_any integer;
  v_body text;
  v_body_lower text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_already_fixed boolean;
begin
  v_function_oid := to_regprocedure('public.auto_link_explore_event()');

  select count(*)
    into v_trigger_count_any
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'events'
     and t.tgname = 'auto_link_explore_event_trigger'
     and not t.tgisinternal;

  if v_function_oid is null and v_trigger_count_any = 0 then
    -- From-scratch migration replay (a fresh local/CI database): neither
    -- object exists yet. Nothing to preflight-check against -- fall
    -- through and let the CREATE OR REPLACE statements below create both,
    -- directly with the fixed logic. The known-buggy version is never
    -- created here, not even transiently.
    return;
  end if;

  if v_function_oid is null or v_trigger_count_any = 0 then
    raise exception 'refusing repair: found only one of {function present=%, trigger count=%} -- unexpected partial state, needs manual review',
      (v_function_oid is not null), v_trigger_count_any;
  end if;

  -- Both exist. Acceptable states from here: the known-buggy production
  -- body (repair path), or this migration's own fix already applied
  -- (idempotent re-run). Anything else is unrecognized drift -- refuse
  -- rather than guess.
  select pg_get_functiondef(p.oid), r.rolname, p.prosecdef, p.proconfig
    into v_body, v_owner, v_security_definer, v_config
    from pg_proc p
    join pg_roles r on r.oid = p.proowner
   where p.oid = v_function_oid;

  if v_owner <> 'postgres' or not v_security_definer
     or not coalesce('search_path=public' = any(v_config), false) then
    raise exception 'refusing repair: auto_link_explore_event ownership/security posture is unexpected';
  end if;

  v_body_lower := lower(v_body);
  v_already_fixed := position('v_match_count' in v_body_lower) > 0;

  if not v_already_fixed then
    -- Distinctive substrings of the KNOWN-buggy body, chosen to avoid any
    -- embedded single-quote literal (fragile to hand-write/verify without
    -- a live DB to test against).
    if position('new.explore_event_id is not null' in v_body_lower) = 0
       or position('from explore_events' in v_body_lower) = 0
       or position('lower(trim(title)) = lower(trim(new.title))' in v_body_lower) = 0
       or position('limit 1' in v_body_lower) = 0 then
      raise exception 'refusing repair: unexpected auto_link_explore_event body -- matches neither the known-buggy shape nor this migration''s own fix';
    end if;
  end if;

  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'events'
       and t.tgname = 'auto_link_explore_event_trigger'
       and t.tgfoid = v_function_oid
       and t.tgtype = 7 -- ROW(1) | BEFORE(2) | INSERT(4)
       and not t.tgisinternal
  ) then
    raise exception 'refusing repair: auto_link_explore_event_trigger exists but is not the expected BEFORE INSERT FOR EACH ROW trigger on this function';
  end if;
end;
$preflight$;

create or replace function public.auto_link_explore_event()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_explore_id uuid;
  v_match_count integer;
begin
  if NEW.explore_event_id is not null then
    return NEW;
  end if;

  -- Count and pick in one pass: min(id) is only ever read when the count is
  -- exactly 1, so which single row an aggregate happens to touch never
  -- matters. Zero matches: count = 0, min(id) = null, same no-op as before.
  -- Exactly one match: count = 1, min(id) is that one row's id, same
  -- outcome as before. Two or more matches (the bug): count > 1, and
  -- explore_event_id is left as-is (null, since we already returned above
  -- if it was set) instead of the old arbitrary LIMIT-1 guess.
  select count(*), min(id)
    into v_match_count, v_explore_id
    from explore_events
   where status = 'Live'
     and lower(trim(title)) = lower(trim(NEW.title));

  if v_match_count = 1 then
    NEW.explore_event_id := v_explore_id;
  end if;

  return NEW;
end;
$function$;

-- Capture the trigger attachment into version control for the first time
-- (this repo has never had a migration for it before -- see header above).
-- Safe to reissue identically against production, where it already exists
-- pointing at this same function name: CREATE OR REPLACE TRIGGER recreates
-- an identical attachment, so the only real change on production is the
-- function body swap above. On a from-scratch replay this is what actually
-- creates the trigger for the first time.
create or replace trigger auto_link_explore_event_trigger
before insert on public.events
for each row
execute function public.auto_link_explore_event();

do $verify$
declare
  v_body text;
  v_body_lower text;
  v_trigger_ok boolean;
begin
  select pg_get_functiondef(p.oid)
    into v_body
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'auto_link_explore_event'
     and pg_get_function_identity_arguments(p.oid) = '';

  v_body_lower := lower(v_body);

  if position('v_match_count' in v_body_lower) = 0
     or position('count(*)' in v_body_lower) = 0
     or position('min(id)' in v_body_lower) = 0
     or position('new.explore_event_id is not null' in v_body_lower) = 0
     or position('lower(trim(title)) = lower(trim(new.title))' in v_body_lower) = 0 then
    raise exception 'self-test failed: auto_link_explore_event does not contain the expected uniqueness-gated fix';
  end if;

  select exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'events'
       and t.tgname = 'auto_link_explore_event_trigger'
       and t.tgfoid = 'public.auto_link_explore_event()'::regprocedure
       and t.tgtype = 7
       and not t.tgisinternal
  ) into v_trigger_ok;

  if not v_trigger_ok then
    raise exception 'self-test failed: auto_link_explore_event_trigger is missing or not the expected BEFORE INSERT FOR EACH ROW shape';
  end if;
end;
$verify$;

commit;
