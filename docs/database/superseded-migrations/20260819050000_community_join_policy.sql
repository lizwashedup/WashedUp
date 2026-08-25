-- ARCHIVED. NON-EXECUTABLE. INCOMPATIBLE WITH THE OBSERVED LIVE TEXT COLUMN.
-- ============================================================================
-- community join policy (inventory C-08, "proposal 91" -- the "who gets in"
-- three-way picker already built and wired on BOTH join-gate screens
-- (app/creator/join-gate.tsx, src/app/app/creator/join-gate/page.tsx), gated
-- behind JOIN_GATE_ENABLED and a self-flipping read that has had nothing to
-- read since it was written: communities.join_policy and
-- set_community_join_policy() were referenced by name in 7+ places in both
-- repos' comments but never actually written as a migration anywhere.
--
-- ADDITIVE ONLY. NOT applied anywhere -- written 2026-08-19, sits in the repo
-- until Josh applies it, same pattern as the other 2026-08-18/19 migrations
-- in this same folder. Do not flip JOIN_GATE_ENABLED on for a real build
-- until this is applied AND Liz gives the word on the copy (both platforms'
-- feature-flag comments already say this; unchanged by this migration).
--
-- WHAT THIS DOES NOT DECIDE: which of the three modes a brand-new community
-- should have PRE-SELECTED in the picker is founder-approval-gate #3 (open
-- vs. creator-approval-required by default), still genuinely open.
--
-- COLUMN DEFAULT, REVISED 2026-08-20: originally 'open' (matching what both
-- clients' code independently assumed pre-column, see git history on this
-- line). A pre-apply review caught that 'open' is NOT behavior-neutral: since
-- create_community() never sets join_policy explicitly, every EXISTING
-- community would inherit 'open' the instant this migration applies, and
-- request_to_join_community() below would then auto-activate every join
-- request immediately instead of landing in the leader's pending queue --
-- for every community that exists today, live, independent of whether
-- JOIN_GATE_ENABLED is on (that flag only gates the client-side picker UI,
-- it has no bearing on what this RPC does once replaced). Changed the
-- default to 'approval_required' so applying this migration preserves
-- today's actual live behavior (100% pending-queue) for every existing
-- community with zero surprise change. Gate 3 above is still unanswered and
-- still governs only what a BRAND-NEW community should default to; flipping
-- this column default once that's decided remains a one-line follow-up
-- migration, unchanged in spirit from the original plan.
--
-- WHAT THIS DOES NOT BUILD: real invite-code generation/redemption for the
-- invite_only mode. That is already explicitly commented out of scope in
-- both join-gate screens ("its own, larger feature ... not a small wire-up")
-- by the agent who built the picker UI. This migration accepts invite_only
-- as a value (so the picker's third pill has somewhere real to write) but
-- request_to_join_community below treats it exactly like approval_required
-- -- fails CLOSED into a real human review, never silently opens the door a
-- leader explicitly set to be the most restricted of the three.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. the column
-- ---------------------------------------------------------------------------

create type public.community_join_policy as enum ('open', 'approval_required', 'invite_only');

alter table public.communities
  add column join_policy public.community_join_policy not null default 'approval_required';

comment on column public.communities.join_policy is
  'Who gets in without a leader reviewing them first (inventory C-08 / proposal 91). open = request_to_join_community activates immediately, no queue. approval_required = today''s existing pending-queue behavior. invite_only = also falls through to the pending queue for now: no real invite-code mechanism exists yet, so this fails closed into review rather than silently behaving like open. Written only through set_community_join_policy(); see the trigger below.';

-- ---------------------------------------------------------------------------
-- 2. one write door: set_community_join_policy(). A direct client
--    .update({ join_policy }) would otherwise pass the existing
--    communities_update RLS policy (any leader can update any column of
--    their own row) -- this trigger closes that specific column regardless
--    of who owns the row, so the SECURITY DEFINER RPC below is the only
--    path in, matching the "self-flipping, RPC-only" contract already
--    written into both platforms' lib/creatorMode.ts / creator.ts comments.
--    Scoped to this one column only: every other direct client write to
--    communities (name, description, join_welcome_message, city, ...)
--    is completely unaffected.
-- ---------------------------------------------------------------------------

create or replace function public.communities_guard_join_policy_write()
returns trigger
language plpgsql
as $$
begin
  if new.join_policy is distinct from old.join_policy
     and coalesce(current_setting('washedup.allow_join_policy_write', true), 'false') <> 'true'
  then
    raise exception 'join_policy can only be changed through set_community_join_policy()';
  end if;
  return new;
end;
$$;

drop trigger if exists communities_guard_join_policy_write on public.communities;
create trigger communities_guard_join_policy_write
  before update on public.communities
  for each row execute function public.communities_guard_join_policy_write();

create or replace function public.set_community_join_policy(
  p_community_id uuid,
  p_join_policy public.community_join_policy
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_found uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  -- SUPERSEDED by S-03 (20260821020000_community_role_tiers_capabilities.sql
  -- section 7): that migration's CREATE OR REPLACE swaps this check to
  -- can_manage_community_members (Member care+, matching "join-door
  -- settings" in the S-03 capability matrix), not edited here because
  -- can_manage_community_members does not exist yet at this file's own
  -- position in the migration sequence (2026-08-19, before S-03). If S-03 is
  -- ever reverted, this file's own is_community_leader check below is what
  -- actually runs again.
  if not (
    public.is_community_leader(p_community_id, v_uid)
    or public.is_admin(v_uid) or public.has_role(v_uid, 'admin'::public.app_role)
  ) then
    raise exception 'Leader access required';
  end if;

  perform set_config('washedup.allow_join_policy_write', 'true', true); -- true = local to this transaction only
  update public.communities set join_policy = p_join_policy where id = p_community_id
  returning id into v_found;

  if v_found is null then
    raise exception 'Community not found';
  end if;
end;
$$;

revoke all on function public.set_community_join_policy(uuid, public.community_join_policy) from public;
revoke all on function public.set_community_join_policy(uuid, public.community_join_policy) from anon;
grant execute on function public.set_community_join_policy(uuid, public.community_join_policy) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. request_to_join_community: same signature (uuid, jsonb), same live
--    validation and answer-storage logic as the applied 2026-07-06 version
--    (20260706100500_join_flow.sql), unchanged. The ONLY addition is the
--    branch at the end: an open community activates immediately instead of
--    landing in the pending queue, doing the same topic/subscribe/intro-post
--    steps review_community_join's approve path already does on prod, just
--    with no leader in the loop (actor_user_id on the notification is left
--    null -- nobody approved this, the door was already open). This is a
--    deliberate copy-paste of that block rather than a shared helper: it
--    keeps review_community_join, a live self-tested function, completely
--    untouched, at the cost of ~15 duplicated lines.
--    approval_required and invite_only both fall through to the exact
--    existing pending+leader-notification behavior, byte-identical to today.
-- ---------------------------------------------------------------------------

create or replace function public.request_to_join_community(
  p_community_id uuid,
  p_answers jsonb
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_community record;
  v_existing record;
  v_member_id uuid;
  v_first text;
  v_stored jsonb;
  v_topic_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select id, name, status, join_policy into v_community
  from communities where id = p_community_id;
  if v_community.id is null or v_community.status <> 'active' then
    raise exception 'That community is not open to joins right now.';
  end if;

  -- every field required, validated server-side (the popup mirrors this)
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers are required.';
  end if;
  if coalesce(btrim(p_answers->>'first_name'), '') = ''
     or char_length(p_answers->>'first_name') > 100 then
    raise exception 'First name is required.';
  end if;
  if coalesce(btrim(p_answers->>'last_name'), '') = ''
     or char_length(p_answers->>'last_name') > 100 then
    raise exception 'Last name is required.';
  end if;
  if coalesce(btrim(p_answers->>'email'), '') = ''
     or p_answers->>'email' !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or char_length(p_answers->>'email') > 254 then
    raise exception 'A real email is required.';
  end if;
  if coalesce(btrim(p_answers->>'zip'), '') = ''
     or p_answers->>'zip' !~ '^[0-9]{5}$' then
    raise exception 'A 5 digit zip code is required.';
  end if;
  if coalesce(btrim(p_answers->>'intro_answer'), '') = ''
     or char_length(p_answers->>'intro_answer') > 1000 then
    raise exception 'Your introduction is required.';
  end if;
  if coalesce((p_answers->>'guidelines_accepted')::boolean, false) is not true then
    raise exception 'Accepting the community guidelines is required.';
  end if;

  -- whitelist: store exactly the doc 09 keys, nothing else
  v_stored := jsonb_build_object(
    'first_name', btrim(p_answers->>'first_name'),
    'last_name', btrim(p_answers->>'last_name'),
    'email', btrim(p_answers->>'email'),
    'zip', btrim(p_answers->>'zip'),
    'intro_answer', btrim(p_answers->>'intro_answer'),
    'guidelines_accepted_at', now()
  );

  select id, status into v_existing
  from community_members
  where community_id = p_community_id and user_id = v_uid;

  if v_existing.id is null then
    insert into community_members (community_id, user_id, role, status)
    values (p_community_id, v_uid, 'member', 'pending')
    returning id into v_member_id;
  elsif v_existing.status = 'left' then
    -- rejoining after leaving on good terms: same row back to pending
    update community_members
    set status = 'pending', joined_at = null
    where id = v_existing.id;
    v_member_id := v_existing.id;
  elsif v_existing.status = 'pending' then
    raise exception 'You already asked to join. The leader has your request.';
  elsif v_existing.status = 'active' then
    raise exception 'You are already a member.';
  else
    -- declined, removed, or banned: rejoin-after-decline is a logged open
    -- question, now revisitable thanks to the distinct 'declined' status
    raise exception 'You cannot join this community right now.';
  end if;

  -- answers land ONLY in the private table (leader-eyes-only by RLS)
  insert into community_member_answers (member_id, community_id, user_id, answers)
  values (v_member_id, p_community_id, v_uid, v_stored)
  on conflict (member_id)
  do update set answers = excluded.answers, updated_at = now();

  -- inventory C-08 / proposal 91: open skips the queue entirely
  if coalesce(v_community.join_policy, 'approval_required') = 'open' then
    update community_members set status = 'active', joined_at = now() where id = v_member_id;

    select id into v_topic_id
    from community_topics
    where community_id = p_community_id and is_default and not archived;
    if v_topic_id is null then
      begin
        insert into community_topics (community_id, name, created_by, is_default)
        values (p_community_id, 'introductions', v_uid, true)
        returning id into v_topic_id;
      exception when unique_violation then
        select id into v_topic_id
        from community_topics
        where community_id = p_community_id and is_default and not archived;
      end;
    end if;

    insert into community_topic_members (topic_id, user_id)
    values (v_topic_id, v_uid)
    on conflict (topic_id, user_id) do nothing;

    if coalesce(btrim(v_stored->>'intro_answer'), '') <> '' then
      insert into community_topic_messages (topic_id, sender_id, body)
      values (v_topic_id, v_uid, btrim(v_stored->>'intro_answer'));
    end if;

    -- same notification type + copy review_community_join's approve path
    -- sends, so no client-side display change is needed. actor_user_id is
    -- null on purpose: nobody approved this, the door was already open.
    insert into app_notifications (user_id, type, title, body, actor_user_id)
    values (
      v_uid,
      'community_join_approved',
      'you''re in',
      v_community.name || ' let you in. your introduction is already posted, come say hi.',
      null
    );
    return;
  end if;

  -- approval_required or invite_only: today's unchanged pending+notify path
  -- (invite_only fails closed into review, see file header)
  v_first := v_stored->>'first_name';
  insert into app_notifications (user_id, type, title, body, actor_user_id)
  select m.user_id,
         'community_join_request',
         'someone wants in',
         v_first || ' asked to join ' || v_community.name || '. their introduction is waiting for you.',
         v_uid
  from community_members m
  where m.community_id = p_community_id
    and m.role in ('leader', 'co_leader')
    and m.status = 'active';
end;
$$;

revoke all on function public.request_to_join_community(uuid, jsonb) from public;
revoke all on function public.request_to_join_community(uuid, jsonb) from anon;
grant execute on function public.request_to_join_community(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. in-transaction self-test (never strip on apply). Reuses three existing
--    non-admin users the same way 20260706100500_join_flow.sql's own
--    self-test does. Cleans up everything it creates.
-- ---------------------------------------------------------------------------
do $$
declare
  v_leader uuid;
  v_joiner uuid;
  v_other uuid;
  v_cid uuid;
  v_member_id uuid;
  v_topic_id uuid;
  v_raised boolean;
  v_status public.community_member_status;
  v_joined_at timestamptz;
  v_policy public.community_join_policy;
  v_answers jsonb := jsonb_build_object(
    'first_name', 'Sage', 'last_name', 'Selftest',
    'email', 'sage@example.com', 'zip', '90026',
    'intro_answer', 'my go-to taco spot is the one on the corner.',
    'guidelines_accepted', true
  );
begin
  select id into v_leader from auth.users u
  where not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_joiner from auth.users u
  where u.id <> v_leader
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_other from auth.users u
  where u.id not in (v_leader, v_joiner)
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  if v_leader is null or v_joiner is null or v_other is null then
    raise exception 'SELF-TEST FAIL: needs three existing non-admin users';
  end if;

  -- 4a. column default is approval_required (2026-08-20: changed from open
  -- so applying this migration cannot silently flip live join behavior for
  -- every existing community -- see header)
  insert into public.communities (handle, name, created_by, status)
  values ('selftest-join-policy', 'Join Policy Selftest', v_leader, 'active')
  returning id, join_policy into v_cid, v_policy;
  if v_policy <> 'approval_required' then
    raise exception 'SELF-TEST FAIL: join_policy column default is not approval_required';
  end if;
  insert into public.community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_leader, 'leader', 'active', now());

  -- 4b. a non-leader cannot call set_community_join_policy
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_joiner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.set_community_join_policy(v_cid, 'approval_required');
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a non-leader set the join policy';
  end if;

  -- 4c. a direct client-style UPDATE is blocked even for the leader (the
  --     one-write-door trigger), every other column stays writable
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    update public.communities set join_policy = 'invite_only' where id = v_cid;
  exception when others then v_raised := true;
  end;
  if not v_raised then
    reset role;
    raise exception 'SELF-TEST FAIL: a direct UPDATE changed join_policy outside the RPC';
  end if;
  update public.communities set name = 'Join Policy Selftest (renamed)' where id = v_cid;
  if not exists (select 1 from public.communities where id = v_cid and name = 'Join Policy Selftest (renamed)') then
    reset role;
    raise exception 'SELF-TEST FAIL: the guard trigger blocked an unrelated column, not just join_policy';
  end if;
  reset role;

  -- 4d. the leader CAN set it through the RPC
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_community_join_policy(v_cid, 'approval_required');
  reset role;
  select join_policy into v_policy from public.communities where id = v_cid;
  if v_policy <> 'approval_required' then
    raise exception 'SELF-TEST FAIL: set_community_join_policy did not persist';
  end if;

  -- 4e. approval_required: request_to_join_community behaves exactly like
  --     today, unchanged -- pending, no auto-activation
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_joiner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.request_to_join_community(v_cid, v_answers);
  reset role;
  select id, status, joined_at into v_member_id, v_status, v_joined_at
  from public.community_members where community_id = v_cid and user_id = v_joiner;
  if v_status <> 'pending' or v_joined_at is not null then
    raise exception 'SELF-TEST FAIL: approval_required did not leave the joiner pending';
  end if;
  perform public.review_community_join(v_member_id, false); -- reset for the next case, as the leader (session role already superuser here, fine for a decline)

  -- 4f. invite_only fails closed into review too (not open, not silently blocked)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_community_join_policy(v_cid, 'invite_only');
  reset role;
  delete from public.community_members where id = v_member_id; -- clear the declined row so the joiner can request again
  delete from public.community_member_answers where member_id = v_member_id;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_joiner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.request_to_join_community(v_cid, v_answers);
  reset role;
  select id, status into v_member_id, v_status
  from public.community_members where community_id = v_cid and user_id = v_joiner;
  if v_status <> 'pending' then
    raise exception 'SELF-TEST FAIL: invite_only did not fail closed into pending review';
  end if;
  delete from public.community_members where id = v_member_id;
  delete from public.community_member_answers where member_id = v_member_id;

  -- 4g. open activates immediately: active member, introductions topic
  --     exists with their intro posted, "you're in" notification with a
  --     NULL actor (nobody approved this)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_community_join_policy(v_cid, 'open');
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.request_to_join_community(v_cid, v_answers || jsonb_build_object('email', 'other@example.com'));
  reset role;
  select id, status, joined_at into v_member_id, v_status, v_joined_at
  from public.community_members where community_id = v_cid and user_id = v_other;
  if v_status <> 'active' or v_joined_at is null then
    raise exception 'SELF-TEST FAIL: open did not activate the joiner immediately';
  end if;
  select id into v_topic_id from public.community_topics
  where community_id = v_cid and is_default and name = 'introductions';
  if v_topic_id is null then
    raise exception 'SELF-TEST FAIL: open join never created the introductions topic';
  end if;
  if not exists (select 1 from public.community_topic_messages
                 where topic_id = v_topic_id and sender_id = v_other
                   and body = 'my go-to taco spot is the one on the corner.') then
    raise exception 'SELF-TEST FAIL: open join did not post the intro';
  end if;
  if not exists (select 1 from public.app_notifications
                 where user_id = v_other and type = 'community_join_approved' and actor_user_id is null) then
    raise exception 'SELF-TEST FAIL: open join notification missing or wrongly attributed to an actor';
  end if;

  -- cleanup
  delete from public.app_notifications
  where type in ('community_join_request', 'community_join_approved', 'community_join_declined')
    and user_id in (v_leader, v_joiner, v_other);
  delete from public.communities where id = v_cid; -- cascades members, answers, topics, topic members, messages

  raise notice 'community join policy self-test passed';
end;
$$;

commit;
