-- DO NOT APPLY until the check below has been run against the live DB.
-- Independent security review (2026-08-21) found a real, unresolved
-- dependency this migration's safety rests on: the trigger path now trusts
-- NEW.creator_user_id unconditionally (no more auth.uid() self-check at
-- all for that path -- see part 3 below). That's fine IF events.creator_
-- user_id can only ever be set to auth.uid() at INSERT time. It's a real
-- integrity hole if a client can set it to an arbitrary uuid: today, a
-- spoofed creator_user_id just makes someone's join throw an error
-- (annoying, already broken, not a security issue). After this migration
-- applies, the exact same spoof would instead silently mint fraudulent
-- milestone marks for an arbitrary target user, because the self-check that
-- currently blocks that (incidentally, as a side effect of almost never
-- matching a non-creator caller) is gone from the trigger path on purpose.
--
-- events predates this migrations folder entirely -- no CREATE TABLE, no
-- ENABLE ROW LEVEL SECURITY, and no INSERT policy for it exists anywhere in
-- this repo's migration history (confirmed by two independent full-repo
-- greps, 2026-08-21). It was created outside version control (dashboard, or
-- a pre-migrations baseline). This cannot be verified without a live DB
-- connection, which was not available this session.
--
-- REQUIRED before applying this file:
--   select policyname, cmd, with_check from pg_policies
--   where schemaname = 'public' and tablename = 'events';
-- Confirm the INSERT policy's with_check enforces creator_user_id =
-- auth.uid(). If confirmed: safe to apply as-is, every other claim in this
-- file has been independently verified. If NOT confirmed (or no such policy
-- exists): do not apply this file until events' own INSERT path is locked
-- down first -- that is a separate, bigger fix, not a same-night addition
-- to this one.
--
-- Fixes the real gap flagged (not fixed) in 20260819193833: that migration
-- only stopped check_creator_milestones from throwing 'unauthorized' when
-- auth.uid() IS NULL (the cron/system case). It never stopped the far more
-- common case: a real, legitimately authenticated GUEST filling an event's
-- last open spot. join_event_atomic (20260812120000) lets a guest join
-- under their own real session, and when that join fills the event, it
-- UPDATEs events.status -- firing this same trigger. auth.uid() there is
-- the guest, never the creator, so check_creator_milestones's own self-check
-- (`auth.uid() IS NULL OR auth.uid() <> p_user_id`, from 20260813025124)
-- still throws 'unauthorized', and join_event_atomic has no exception
-- handler, so the guest's ENTIRE join fails -- not just the milestone
-- check. Reproduced empirically 2026-08-21 in a throwaway test database
-- before writing this fix.
--
-- This is a PRE-EXISTING bug, not introduced by 20260819193833 -- the old
-- unconditional trigger body failed the exact same way for this exact case.
-- It predates every migration in tonight's batch and is unrelated to
-- whether any of them ever get applied.
--
-- Root cause: check_creator_milestones's self-check is CORRECT for its
-- designed purpose (20260813025124's own header: closing a function with
-- "zero live callers anywhere" against a hypothetical direct client call
-- that could award one user's milestones under another user's id). It was
-- never designed to be called from a trigger, and 20260819193833 was the
-- first migration to ever actually wire a caller to it. A trigger's own
-- SECURITY DEFINER context plus a trusted, already-stored NEW.creator_user_id
-- (a table column, not attacker-supplied input) is a different, already-
-- correct authorization boundary -- the self-check re-applying auth.uid() on
-- top of that is simply the wrong check for this caller, not a check that
-- needs weakening for everyone.
--
-- Fix: split the milestone logic into a new internal function with NO
-- self-check and NO client grants at all (not callable by anon or
-- authenticated, only by another SECURITY DEFINER function/trigger that has
-- already established trust some other way). check_creator_milestones keeps
-- its exact original signature, self-check, and grants -- any direct/client
-- call behaves identically to before, including still rejecting a
-- mismatched p_user_id, which 20260813025124's own self-test already
-- asserts and this migration does not touch. The trigger now calls the
-- internal function directly, bypassing the self-check for every
-- system-driven status change, not just the null-session one -- generalizing
-- 20260819193833's own reasoning ("milestones are not time-critical,
-- skipping the check on a system-driven transition costs nothing") from
-- "no session" to "any caller who isn't the creator itself."

begin;

-- ── 1. internal, non-client-callable milestone logic (moved verbatim out
--      of check_creator_milestones, self-check removed) ──────────────────
create or replace function public._creator_milestones_apply(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count int;
  v_first_plan_id uuid;
  v_anchor_id uuid;
  v_mainstay_id uuid;
begin
  select id into v_first_plan_id from marks where slug = 'first-plan';
  select id into v_anchor_id from marks where slug = 'anchor';
  select id into v_mainstay_id from marks where slug = 'mainstay';

  select count(*) into v_count
  from events
  where creator_user_id = p_user_id
    and status in ('completed', 'full', 'forming');

  if v_count >= 1 and v_first_plan_id is not null then
    insert into user_marks (user_id, mark_id) values (p_user_id, v_first_plan_id)
    on conflict (user_id, mark_id) do nothing;
  end if;

  if v_count >= 3 and v_anchor_id is not null then
    insert into user_marks (user_id, mark_id) values (p_user_id, v_anchor_id)
    on conflict (user_id, mark_id) do nothing;
  end if;

  if v_count >= 8 and v_mainstay_id is not null then
    insert into user_marks (user_id, mark_id) values (p_user_id, v_mainstay_id)
    on conflict (user_id, mark_id) do nothing;
  end if;
end;
$$;

-- deliberately no grants to anon or authenticated -- this function trusts
-- its caller's identity checks, so it must never be directly client-reachable.
revoke all on function public._creator_milestones_apply(uuid) from public, anon, authenticated;

-- ── 2. check_creator_milestones: same signature, same self-check, same
--      grants as 20260813025124 -- now just delegates the real work ──────
create or replace function public.check_creator_milestones(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized';
  end if;
  perform public._creator_milestones_apply(p_user_id);
end;
$function$;

revoke all on function public.check_creator_milestones(uuid) from public, anon;
grant execute on function public.check_creator_milestones(uuid) to authenticated;

-- ── 3. the trigger calls the internal function directly, for ANY status
--      change regardless of who's authenticated (or not) ─────────────────
create or replace function public.trg_events_update_check_marks()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if OLD.status is distinct from NEW.status then
    perform public._creator_milestones_apply(NEW.creator_user_id);
  end if;
  return NEW;
end;
$function$;

-- ---------------------------------------------------------------------------
-- self-test: real, in-transaction, exercises every scenario above against
-- real rows, not just the two 20260819193833 already covered.
-- ---------------------------------------------------------------------------
do $$
declare
  v_creator uuid;
  v_guest uuid;
  v_stranger uuid;
  v_event_guest_fills uuid;
  v_event_creator_completes uuid;
  v_event_cron uuid;
  v_msg text;
  v_raised boolean;
  v_mark_count int;
  v_prior_mark_ids uuid[];
begin
  select id into v_creator from auth.users u
  where not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_guest from auth.users u
  where u.id <> v_creator
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_stranger from auth.users u
  where u.id not in (v_creator, v_guest)
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  if v_creator is null or v_guest is null or v_stranger is null then
    raise exception 'SELF-TEST FAIL: needs three existing non-admin users';
  end if;

  -- SAFETY FIX (found before this migration's second live attempt,
  -- 2026-08-21): v_creator is a REAL existing production user (the oldest
  -- non-admin account), not a throwaway fixture. The original cleanup below
  -- unconditionally deleted every mark that user has ever earned. Snapshotting
  -- their exact prior mark set before any mutation, so cleanup can restore
  -- exactly that set afterward -- correct even in the edge case where this
  -- user already qualified for a mark by real historical events but the row
  -- had simply never been inserted yet; a name-based guard (e.g. "only ever
  -- touch first-plan") would still wrongly strip that in-that-instant-real
  -- grant, since it can't distinguish "the test manufactured this" from "this
  -- was always true and just got recorded during the test". Diffing against
  -- the snapshot sidesteps that distinction entirely.
  select coalesce(array_agg(mark_id), array[]::uuid[]) into v_prior_mark_ids
  from public.user_marks where user_id = v_creator;

  -- ---------- unchanged behavior: direct call, matching user, succeeds ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.check_creator_milestones(v_creator);
  reset role;
  raise notice 'SELF-TEST 1/6 passed: direct call with matching user still succeeds';

  -- ---------- unchanged behavior: direct call, mismatched user, still rejected ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.check_creator_milestones(v_creator);
  exception when others then
    v_raised := true;
    v_msg := sqlerrm;
  end;
  reset role;
  if not v_raised or v_msg <> 'unauthorized' then
    raise exception 'SELF-TEST FAIL: direct mismatched call was not rejected with unauthorized (got: %)', coalesce(v_msg, 'no error');
  end if;
  raise notice 'SELF-TEST 2/6 passed: direct call with a mismatched user still throws unauthorized -- original 20260813025124 hardening intact';

  -- ---------- _creator_milestones_apply itself is not client-callable ----------
  if has_function_privilege('anon', 'public._creator_milestones_apply(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._creator_milestones_apply(uuid)', 'execute') then
    raise exception 'SELF-TEST FAIL: _creator_milestones_apply is directly callable by a client role -- the self-check bypass is exposed';
  end if;
  raise notice 'SELF-TEST 3/6 passed: the internal helper has zero client-facing grants';

  -- ---------- the actual bug scenario: a real GUEST (not the creator) fills the
  -- last spot, causing the trigger's UPDATE -- this must now succeed ----------
  -- title/start_time/gender_rule are NOT NULL live with no default (confirmed
  -- 2026-08-21 against the real schema; the migration as originally written
  -- omitted them and failed its own self-test on first live attempt).
  --
  -- SECOND FIX, same live attempt: creating this row also fires the
  -- pre-existing (unmodified by this migration) AFTER INSERT trigger
  -- trg_events_after_insert_marks -> check_creator_milestones(NEW.creator_
  -- user_id), which requires auth.uid() = v_creator at insert time. Real
  -- client inserts always satisfy this (events' own INSERT policy enforces
  -- creator_user_id = auth.uid()), so this is not a production bug -- but
  -- the ambient request.jwt.claims left over from SELF-TEST 2 above (set to
  -- v_stranger, never cleared) does not, and made this insert itself throw
  -- 'unauthorized' on the second live attempt. Scoping the correct identity
  -- around the insert, matching what a real client session looks like.
  perform set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.events (id, status, creator_user_id, title, start_time, gender_rule)
  values (gen_random_uuid(), 'active', v_creator, 'selftest-creator-milestones-guest-fills', now() + interval '1 day', 'mixed')
  returning id into v_event_guest_fills;
  reset role;

  -- FOURTH FIX, same live attempt: in real production this UPDATE is
  -- performed BY join_event_atomic (a SECURITY DEFINER RPC), not by the
  -- guest issuing a raw client UPDATE -- confirmed live: events' real
  -- UPDATE policy is `auth.uid() = creator_user_id OR admin`, so a guest
  -- directly holding the 'authenticated' role would have this row silently
  -- filtered to 0 matches by RLS before any trigger even runs, making the
  -- test pass vacuously (no exception, but nothing was ever proven -- the
  -- trigger this test exists to exercise never fires on a 0-row update).
  -- Setting only the jwt claims (so auth.uid() correctly reflects the guest
  -- for the trigger's own internal logic) without switching the Postgres
  -- role reproduces what the real definer RPC actually does: privileged
  -- write, guest identity. Confirmed by direct live probing 2026-08-21 (a
  -- throwaway rollback-only script) that this is what makes the row update
  -- genuinely take effect and the trigger genuinely fire.
  perform set_config('request.jwt.claims', json_build_object('sub', v_guest, 'role', 'authenticated')::text, true);
  v_raised := false;
  begin
    update public.events set status = 'full' where id = v_event_guest_fills;
  exception when others then
    v_raised := true;
    v_msg := sqlerrm;
  end;
  if v_raised then
    raise exception 'SELF-TEST FAIL: a real guest (not the creator) filling the last spot still throws: %', v_msg;
  end if;
  if (select status from public.events where id = v_event_guest_fills) <> 'full' then
    raise exception 'SELF-TEST FAIL: the guest-fills update reported no error but the row never actually changed to full -- the update silently affected 0 rows';
  end if;
  raise notice 'SELF-TEST 4/6 passed: a real guest filling the last spot no longer breaks the status update (THE bug this migration fixes)';

  -- ---------- the creator's own action still works too ----------
  -- (identity scoped around the insert too, same reason as the guest-fills
  -- insert above -- the AFTER INSERT trigger needs auth.uid() = v_creator)
  perform set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.events (id, status, creator_user_id, title, start_time, gender_rule)
  values (gen_random_uuid(), 'active', v_creator, 'selftest-creator-milestones-creator-completes', now() + interval '1 day', 'mixed')
  returning id into v_event_creator_completes;
  update public.events set status = 'completed' where id = v_event_creator_completes;
  reset role;
  raise notice 'SELF-TEST 5/6 passed: a real status change by the creator themself still works';

  -- ---------- the original 20260819193833 cron/no-session case still works ----------
  -- (insert still needs the creator's real identity for the AFTER INSERT
  -- trigger; role is reset back to no-session BEFORE the no-session update
  -- below, so that update genuinely exercises the empty-claims/cron path)
  perform set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.events (id, status, creator_user_id, title, start_time, gender_rule)
  values (gen_random_uuid(), 'active', v_creator, 'selftest-creator-milestones-cron', now() + interval '1 day', 'mixed')
  returning id into v_event_cron;
  reset role;

  perform set_config('request.jwt.claims', '', true);
  update public.events set status = 'completed' where id = v_event_cron;
  raise notice 'SELF-TEST 6/6 passed: the original no-session cron case (20260819193833) still works, not regressed';

  -- ---------- functional correctness: confirm a real mark actually landed,
  -- not just "no exception thrown".
  --
  -- THIRD FIX, same live attempt: the original check here hardcoded a
  -- 'first-plan' slug at a hardcoded threshold-crossing step, on the
  -- assumption (a) a 'first-plan' mark exists and (b) the update trigger is
  -- BEFORE UPDATE (so each transition only ever sees PRIOR events as
  -- already-qualifying). Both assumptions were wrong against live prod,
  -- confirmed by direct query 2026-08-21: public.marks has no 'first-plan'
  -- row at all (only 'anchor' and 'mainstay' exist), and
  -- trg_events_after_update_marks / trg_events_after_insert_marks are both
  -- genuinely AFTER triggers (pg_get_triggerdef confirmed), so each
  -- transition sees its OWN just-written row too, not just prior ones. Also,
  -- v_creator is a real production user with real pre-existing history (this
  -- account already had 1 real qualifying event and 1 unrelated mark before
  -- this test ever ran) -- a hardcoded expected count would be fragile
  -- against whatever this account's real data happens to be on any given
  -- day. Checking against the v_prior_mark_ids snapshot instead sidesteps
  -- every one of those assumptions: it only asserts that a trigger-driven
  -- transition genuinely changed this real user's mark state at all, which
  -- is the actual thing this check exists to prove.
  select count(*) into v_mark_count
  from public.user_marks
  where user_id = v_creator and mark_id <> all (v_prior_mark_ids);
  if v_mark_count < 1 then
    raise exception 'SELF-TEST FAIL: no new mark was granted by any of the 3 trigger-driven transitions (user_marks unchanged from the pre-test snapshot)';
  end if;
  raise notice 'FUNCTIONAL CHECK passed: % new mark(s) genuinely landed from real trigger-driven transitions -- not just a no-error pass', v_mark_count;

  -- ---------- cleanup: restore user_marks to EXACTLY the snapshot taken
  -- before this test touched anything -- removes only rows this test run
  -- itself added, regardless of which mark or why. A real user's
  -- pre-existing marks, of any kind, are never touched. ----------
  delete from public.user_marks
  where user_id = v_creator
    and mark_id <> all (v_prior_mark_ids);
  delete from public.events where id in (v_event_guest_fills, v_event_creator_completes, v_event_cron);

  raise notice 'creator-milestones-trigger-auth-gap self-test passed: all 6 scenarios + 1 functional check';
end;
$$;

commit;
