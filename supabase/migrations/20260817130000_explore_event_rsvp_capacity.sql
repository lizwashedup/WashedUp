-- ============================================================================
-- explore_event_rsvp_capacity (2026-08-17) -- DRAFT, NOT YET APPLIED
--
-- Written by an agent whose isolated worktree pointed at the wrong repo
-- (command-center-next, not WashedUp -- a real workflow-orchestration bug,
-- confirmed and already fixed for future dispatches). Read-only investigation
-- of WashedUp only: no git access to it, could not run this against a real
-- database, could not run `npm test` / `npm run typecheck` /
-- `node scripts/db-contracts/static-contracts.mjs`. Everything below needs
-- real verification by whoever applies it. See the handoff report for the
-- full reasoning; the highlights are inlined below at each risk point.
--
-- WHAT THIS DOES
--   1. Adds explore_events.ticket_capacity if it's genuinely missing (see
--      RISK A below -- it should already exist).
--   2. Adds set_event_rsvp_atomic(p_event_id, p_going): the real fix. Mirrors
--      this repo's OWN established pattern for this exact problem shape --
--      join_event_atomic in 20260302000000_fix_race_conditions.sql: lock the
--      parent row with SELECT ... FOR UPDATE, recount children inside the
--      same transaction, decide, act. That lock is what makes two concurrent
--      RSVPs for the last open spot race-free: the second caller blocks on
--      the same row lock until the first commits, then its own count
--      genuinely reflects the first one's write.
--   3. Deliberately does NOT touch operator_create_explore_event. See RISK B
--      below -- this one matters, read it before adding the capacity param
--      to that RPC by hand.
--
-- REJECT, NOT WAITLIST: the only existing "waitlist" concept in this
-- codebase (event_waitlist / waitlist_exceptions, 20250228000000 onward) is
-- scoped to Plans' `events` table, with its own notify-on-open-spot and
-- exceptions machinery -- a materially bigger feature than this task asked
-- for, and the task explicitly says explore-event capacity "does not
-- inherit the ordinary Plans small-group cap." Reject matches the pattern
-- already living on THIS SAME explore_events table for paid capacity
-- (event_add_ons.sold_count in 20260814140000_begin_ticket_checkout_v2.sql:
-- an atomic UPDATE ... WHERE sold_count + qty <= cap, "that add-on just sold
-- out" on failure, no waitlist). A free-RSVP waitlist is new scope, not a
-- bug fix -- flag it to Josh if wanted.
--
-- RISK A -- explore_events.ticket_capacity is not defined by any migration
-- in this repo. Grepped clean across supabase/migrations/, docs/SCHEMA.md,
-- and docs/database/migration-provenance.json. The task brief states it
-- exists live ("confirmed today by direct code audit"), and this repo has
-- multiple confirmed, DOCUMENTED instances of exactly this kind of drift
-- (see lib/creatorEvents.ts's own p_end_time comment under RISK B) -- so
-- I'm treating the brief as correct and writing this defensively rather
-- than doubting it. `ADD COLUMN IF NOT EXISTS` is a genuine no-op against
-- any already-existing same-named column regardless of its real type (it
-- only checks the name), so this line is safe to run either way. The
-- residual risk is my own arithmetic below assuming `integer`: if the live
-- column truly is some other type (numeric would coerce fine in the
-- comparisons below; text would not), that needs a human to check the real
-- live column type before this ships. Comparisons here use plain >= / <,
-- fine against numeric too, only actually wrong against text.
--
-- RISK B -- DO NOT hand-add p_ticket_capacity to operator_create_explore_event
-- by copying the signature tracked in this repo's migrations. It is STALE.
-- Proof: lib/creatorEvents.ts calls this exact RPC today with p_end_time and
-- p_description_blocks, neither of which appears in ANY tracked definition
-- (the newest tracked one, 20260712035429_fix_batch_28_s1_s2_s3_s5.sql, has
-- 14 params, none named either of those). creatorEvents.ts's own comment
-- confirms why: "The column and both operator RPCs' p_end_time already
-- exist on prod (read 2026-07-26); this is the client catching up, no
-- schema change." This repo has an established, deliberate workflow for
-- exactly this situation (visible in fix_batch_28's own header: "every
-- other line is byte-identical to the live definitions (read from prod
-- 2026-07-11)") -- pull the REAL current definition first
-- (`select pg_get_functiondef('public.operator_create_explore_event'::regproc)`
-- against the live DB, or `supabase db pull`), THEN append ONE trailing
-- parameter to THAT, byte-identical otherwise. A blind CREATE OR REPLACE
-- using the stale 14-param signature from this repo would either silently
-- drop p_end_time/p_description_blocks handling in production, or (if
-- Postgres treats the differing arity as a distinct overload rather than a
-- replacement) create an ambiguous second overload PostgREST can't resolve
-- by name. Either outcome breaks live event creation. Not attempted here.
--
--   The minimal, additive diff once you have the real definition:
--     - append to the parameter list:  p_ticket_capacity integer DEFAULT NULL::integer
--     - add right after the existing guards:
--         if p_ticket_capacity is not null and p_ticket_capacity <= 0 then
--           raise exception 'Capacity has to be at least 1, or left blank for unlimited.';
--         end if;
--     - add `ticket_capacity` to the INSERT column list and `p_ticket_capacity`
--       to the matching VALUES position.
--   operator_update_explore_event is also untouched here -- the task named
--   only "the publish RPC." A creator currently has no way to change
--   capacity after publish; that's a real, separate gap, flagged not fixed,
--   same drift caveat applies there too (it also already has a live
--   p_end_time per the same comment).
--
-- qa/requirements.json's 51 R-ids (checked via qa/check-traceability.cjs)
-- have no entry matching RSVP/explore-event capacity by title -- "SPEC ITEM
-- 04" in the task brief evidently names a different, not-yet-seen CTO scope
-- doc, not this repo's tracked 39-page package. Left untouched.
--
-- scripts/db-contracts/migration-contracts.json will need a new
-- do_fixture_dml entry for this file (it has a self-test DO block, exactly
-- that classification) plus a regenerated migration_count/inventory_sha256,
-- or `npm run test:db:static` (part of `npm run qa:all`) fails on an
-- unclassified file. Not attempted here -- no live repo access.
--
-- Skipped a DB-level CHECK constraint on ticket_capacity (>0) that an
-- earlier draft of this file had: the write tool's own secret-pattern
-- scanner false-positived on the constraint name (an "explore_events_"
-- prefix followed by more identifier text coincidentally resembles a
-- Resend API key shape to that scanner). Not worth fighting for a
-- defense-in-depth extra the task didn't ask for -- the RPC-level guard
-- above (p_ticket_capacity <= 0 check, to add alongside RISK B) already
-- covers the real input-validation need at the one write path that sets it.
-- ============================================================================

begin;

alter table public.explore_events
  add column if not exists ticket_capacity integer;

-- ----------------------------------------------------------------------------
-- set_event_rsvp_atomic: the enforcement point. New function, no drift risk
-- (nothing live to collide with). Handles both directions of the existing
-- setRsvp(id, going) contract in one call:
--   going=true  -> the atomic capacity check (skipped entirely when
--                  ticket_capacity is null: unlimited)
--   going=false -> cancel, never blocked by anything (matches today: the
--                  existing explore_event_rsvps_update RLS policy has no
--                  status gate at all)
--
-- Status-gate parity note: the RLS policy this replaces
-- (explore_event_rsvps_insert, 20260706150000_mvp_batch.sql) only required
-- the event to be Live for a user's very FIRST-EVER RSVP row (a real
-- INSERT); a re-RSVP after cancelling went through the update policy
-- instead, which never checked status at all. Since this function is
-- SECURITY DEFINER (bypasses RLS the way every sibling operator RPC does),
-- it re-implements that exact split explicitly below rather than
-- accidentally tightening or loosening it.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_event_rsvp_atomic(p_event_id uuid, p_going boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_event record;
  v_existing_status text;
  v_going_count integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- Lock the parent event row first (mirrors join_event_atomic in
  -- 20260302000000_fix_race_conditions.sql): everything below runs against
  -- this row's committed state, and a concurrent call for the SAME event
  -- blocks here until this transaction commits or rolls back.
  select id, status, ticket_capacity into v_event
  from explore_events where id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'Event not found';
  end if;

  select status into v_existing_status
  from explore_event_rsvps
  where explore_event_id = p_event_id and user_id = v_uid;

  if coalesce(p_going, true) then
    if v_existing_status is null and v_event.status <> 'Live' then
      raise exception 'This event is not open for RSVPs.';
    end if;

    -- Skip the check entirely when already going (re-confirm / idempotent
    -- re-tap): otherwise a caller's own existing seat would count against
    -- themselves at a full event and wrongly block a no-op re-confirm.
    if v_event.ticket_capacity is not null
       and coalesce(v_existing_status, 'cancelled') <> 'going' then
      select count(*) into v_going_count
      from explore_event_rsvps
      where explore_event_id = p_event_id and status = 'going';

      if v_going_count >= v_event.ticket_capacity then
        raise exception 'This event is full.';
      end if;
    end if;

    insert into explore_event_rsvps (explore_event_id, user_id, status, updated_at)
    values (p_event_id, v_uid, 'going', now())
    on conflict (explore_event_id, user_id)
    do update set status = 'going', updated_at = now();

    return 'going';
  else
    insert into explore_event_rsvps (explore_event_id, user_id, status, updated_at)
    values (p_event_id, v_uid, 'cancelled', now())
    on conflict (explore_event_id, user_id)
    do update set status = 'cancelled', updated_at = now();

    return 'cancelled';
  end if;
end;
$function$;

alter function public.set_event_rsvp_atomic(uuid, boolean) owner to postgres;
revoke all on function public.set_event_rsvp_atomic(uuid, boolean) from public, anon;
grant execute on function public.set_event_rsvp_atomic(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- SELF-TEST (in-transaction, cleans up after itself; house style per
-- fix_batch_28 -- see 20260712035429_fix_batch_28_s1_s2_s3_s5.sql). Picks
-- three REAL existing non-admin users dynamically, same technique as
-- mvp_batch.sql's own self-test (line ~539): explore_event_rsvps.user_id has
-- a hard FK to auth.users, so fabricated UUIDs would just fail with a
-- foreign-key violation instead of testing anything.
--
-- Covers: a capped event fills to exactly capacity then rejects the next
-- comer with the right message; a cancel frees the seat for someone else;
-- re-confirming an already-going RSVP never self-blocks; an unlimited
-- (NULL) event never blocks.
--
-- NOT covered here, and not provable inside one DO block/session: two
-- literally concurrent transactions racing the same last seat. What IS
-- proven here is the mechanism that makes that race safe -- the FOR UPDATE
-- lock on the parent explore_events row serializes any two callers for the
-- same event, which is a structural guarantee from Postgres row locking,
-- not something a single-session test can add confidence to. Real
-- two-connection proof needs a dblink/pg_background contract test (this
-- repo's scripts/db-contracts/ style) or two concurrent supabase-js clients
-- in an integration run against a live test project. Flagging as the one
-- gap self-testing can't close from here.
-- ----------------------------------------------------------------------------

do $selftest$
declare
  v_admin_role text := current_user;
  v_alice uuid;
  v_bob uuid;
  v_cara uuid;
  v_ev_capped uuid;
  v_ev_unlimited uuid;
  v_n integer;
  v_result text;
begin
  select id into v_alice from auth.users u
  where not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_bob from auth.users u
  where u.id <> v_alice
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_cara from auth.users u
  where u.id not in (v_alice, v_bob)
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  if v_alice is null or v_bob is null or v_cara is null then
    raise exception 'SELFTEST FAIL: needs three existing non-admin users';
  end if;

  insert into explore_events (title, category, status, event_date, start_time, ticket_capacity, host_user_id)
  values ('selftest rsvp capacity: capped at 2', 'community', 'Live',
          (now() + interval '5 days')::date, now() + interval '5 days', 2, v_alice)
  returning id into v_ev_capped;

  insert into explore_events (title, category, status, event_date, start_time, ticket_capacity, host_user_id)
  values ('selftest rsvp capacity: unlimited', 'community', 'Live',
          (now() + interval '5 days')::date, now() + interval '5 days', null, v_alice)
  returning id into v_ev_unlimited;

  -- ---------- Alice and Bob fill the 2-cap event ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.set_event_rsvp_atomic(v_ev_capped, true) into v_result;
  if v_result <> 'going' then
    raise exception 'SELFTEST FAIL: Alice should have gotten a seat, got %', v_result;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  select public.set_event_rsvp_atomic(v_ev_capped, true) into v_result;
  if v_result <> 'going' then
    raise exception 'SELFTEST FAIL: Bob should have gotten a seat, got %', v_result;
  end if;

  -- ---------- Cara is the 3rd RSVP against a cap of 2: must reject ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_cara, 'role', 'authenticated')::text, true);
  begin
    perform public.set_event_rsvp_atomic(v_ev_capped, true);
    raise exception 'SELFTEST FAIL: a full-capacity event let a 3rd RSVP through';
  exception
    when others then
      if sqlerrm <> 'This event is full.' then
        raise exception 'SELFTEST FAIL: wrong rejection reason for a full event: %', sqlerrm;
      end if;
  end;

  perform set_config('role', v_admin_role, true);
  select count(*) into v_n from explore_event_rsvps where explore_event_id = v_ev_capped and status = 'going';
  if v_n <> 2 then
    raise exception 'SELFTEST FAIL: expected exactly 2 going after the rejected 3rd RSVP, got %', v_n;
  end if;

  -- ---------- Bob cancels: frees a seat; Cara can now get in ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.set_event_rsvp_atomic(v_ev_capped, false) into v_result;
  if v_result <> 'cancelled' then
    raise exception 'SELFTEST FAIL: Bob should have been able to cancel, got %', v_result;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cara, 'role', 'authenticated')::text, true);
  select public.set_event_rsvp_atomic(v_ev_capped, true) into v_result;
  if v_result <> 'going' then
    raise exception 'SELFTEST FAIL: Cara should have gotten Bobs freed seat, got %', v_result;
  end if;

  perform set_config('role', v_admin_role, true);
  select count(*) into v_n from explore_event_rsvps where explore_event_id = v_ev_capped and status = 'going';
  if v_n <> 2 then
    raise exception 'SELFTEST FAIL: expected exactly 2 going after the cancel/re-RSVP cycle, got %', v_n;
  end if;

  -- ---------- Alice re-confirms an already-going RSVP: must not self-block ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.set_event_rsvp_atomic(v_ev_capped, true) into v_result;
  if v_result <> 'going' then
    raise exception 'SELFTEST FAIL: re-confirming an existing RSVP should not fail, got %', v_result;
  end if;
  perform set_config('role', v_admin_role, true);
  select count(*) into v_n from explore_event_rsvps where explore_event_id = v_ev_capped and status = 'going';
  if v_n <> 2 then
    raise exception 'SELFTEST FAIL: re-confirming should not change the seat count, got %', v_n;
  end if;

  -- ---------- Unlimited (NULL cap) event never blocks ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.set_event_rsvp_atomic(v_ev_unlimited, true) into v_result;
  if v_result <> 'going' then
    raise exception 'SELFTEST FAIL: unlimited event should never reject, got %', v_result;
  end if;

  perform set_config('role', v_admin_role, true);

  -- ---------- cleanup ----------
  delete from explore_event_rsvps where explore_event_id in (v_ev_capped, v_ev_unlimited);
  delete from explore_events where id in (v_ev_capped, v_ev_unlimited);

  raise notice 'SELFTEST PASS: explore_event_rsvp_capacity';
end;
$selftest$;

commit;

notify pgrst, 'reload schema';
