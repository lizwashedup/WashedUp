-- ARCHIVED. NON-EXECUTABLE. DEPENDS ON THE SUPERSEDED ENUM JOIN-POLICY DRAFT.
-- ============================================================================
-- community join review actions (inventory C-12 / C-13): a leader-authored
-- decline message, and a real "ask a follow-up" action that leaves the
-- request pending instead of forcing an immediate approve/decline.
--
-- ADDITIVE ONLY. NOT applied anywhere -- written 2026-08-19, sits in the repo
-- until Josh applies it, same pattern as the other 2026-08-18/19 migrations.
--
-- Scope note: this does NOT build a private, leader-only decline-reason log
-- (that would need a new table + RLS and starts to overlap with C-06
-- "real community rules", which is explicitly specced-not-built tonight).
-- It builds the one piece that is pure wiring: an OPTIONAL applicant-facing
-- message on decline, replacing the one hardcoded string every decline sends
-- today, plus a genuinely new "ask a follow-up" RPC that does not exist in
-- any form yet.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. app_notifications type CHECK: strict superset (+1 value: 32).
--    List below = the LIVE 31-value constraint (20260706150000_mvp_batch.sql,
--    applied to prod 2026-07-06, itself a 29->31 extension of
--    20260706100500_join_flow.sql's 26->29). The guard asserts the
--    pre-change count so silent drift fails loudly, same pattern both of
--    those applied migrations used.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint where conname = 'app_notifications_type_check';
  if v_def is null then
    raise exception 'SELF-TEST FAIL: app_notifications_type_check not found';
  end if;
  if (length(v_def) - length(replace(v_def, '::text', ''))) / length('::text') <> 31 then
    raise exception 'SELF-TEST FAIL: live type CHECK is not the expected 31 values; re-read prod before applying (drift since 2026-07-06)';
  end if;
end;
$$;

alter table public.app_notifications
  drop constraint app_notifications_type_check;
alter table public.app_notifications
  add constraint app_notifications_type_check check (type = any (array[
    'waitlist_spot', 'broadcast', 'event_reminder', 'member_joined',
    'plan_invite', 'invite_accepted', 'new_message', 'album_ready',
    'plan_cancelled', 'duplicate_plan', 'interest_signal', 'interest_invite',
    'album_upload_prompt', 'album_upload_reminder', 'album_someone_uploaded',
    'album_more_photos_added', 'album_creator_no_uploads_nudge',
    'album_hearts_batched', 'waitlist_request', 'exception_invite',
    'exception_slot_refunded', 'people_request', 'people_request_accepted',
    'people_ping', 'referral_joined', 'operator_grant',
    'community_join_request', 'community_join_approved', 'community_join_declined',
    'community_broadcast', 'community_event',
    'community_join_follow_up'
  ]));

-- ---------------------------------------------------------------------------
-- 2. review_community_join: SAME signature plus one new trailing OPTIONAL
--    param (legal via CREATE OR REPLACE -- Postgres allows appending
--    default-valued params without changing the function's identity, so
--    both live call sites (native lib/creatorMode.ts, web
--    src/lib/communities/creator.ts), which pass only p_member_id/p_approve
--    today, keep working with zero client changes required to stay live).
--    Decline path only: p_applicant_message, when provided, REPLACES the
--    one hardcoded decline string every decline sends today. Approve path
--    is completely unchanged.
-- ---------------------------------------------------------------------------
-- drop the live 2-arg signature first: create-or-replace only overloads it
-- (same reasoning as create_community in 20260819000000_community_city.sql),
-- and leaving both signatures live makes every 2-arg call from either live
-- client ambiguous ("review_community_join(uuid, boolean) is not unique")
-- since the 3-arg version below can also satisfy a 2-arg call via its default.
drop function if exists public.review_community_join(uuid, boolean);

create or replace function public.review_community_join(
  p_member_id uuid,
  p_approve boolean,
  p_applicant_message text default null
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_community_name text;
  v_topic_id uuid;
  v_intro text;
  v_message text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select id, community_id, user_id, status into v_row
  from community_members where id = p_member_id;
  if v_row.id is null then
    raise exception 'That request is gone.';
  end if;
  -- SUPERSEDED by S-03 (20260821020000_community_role_tiers_capabilities.sql
  -- section 7): swapped to can_manage_community_members (Member care+) in a
  -- later CREATE OR REPLACE, not here -- that function does not exist yet at
  -- this file's own position in the migration sequence. See the identical
  -- note on set_community_join_policy in 20260819050000.
  if not (is_community_leader(v_row.community_id, v_uid)
          or is_admin(v_uid) or has_role(v_uid, 'admin'::app_role)) then
    raise exception 'Not authorized';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'That request was already handled.';
  end if;

  select name into v_community_name from communities where id = v_row.community_id;

  if not p_approve then
    v_message := nullif(btrim(coalesce(p_applicant_message, '')), '');
    if v_message is not null and char_length(v_message) > 500 then
      raise exception 'Keep the note under 500 characters.';
    end if;
    -- decline: distinct status (Cowork small 1) + a kind note (Liz call a).
    -- inventory C-12: a leader-written note now REPLACES the generic line
    -- when given; unset behaves exactly as it always has.
    update community_members set status = 'declined' where id = v_row.id;
    insert into app_notifications (user_id, type, title, body, actor_user_id)
    values (
      v_row.user_id,
      'community_join_declined',
      'about your request',
      -- LIZ COPY (fallback only; a leader's own note always wins)
      coalesce(v_message, 'not this time, and that''s okay. there are more communities to find.'),
      v_uid
    );
    return;
  end if;

  update community_members
  set status = 'active', joined_at = now()
  where id = v_row.id;

  -- ensure the introductions topic exists (lazy, race-safe via unique index)
  select id into v_topic_id
  from community_topics
  where community_id = v_row.community_id and is_default and not archived;
  if v_topic_id is null then
    begin
      insert into community_topics (community_id, name, created_by, is_default)
      values (v_row.community_id, 'introductions', v_uid, true)
      returning id into v_topic_id;
    exception when unique_violation then
      select id into v_topic_id
      from community_topics
      where community_id = v_row.community_id and is_default and not archived;
    end;
  end if;

  -- bring the member into that chat, notifications on (doc 09 default, Liz call c)
  insert into community_topic_members (topic_id, user_id)
  values (v_topic_id, v_row.user_id)
  on conflict (topic_id, user_id) do nothing;

  -- their introduction posts as them (answer-less rows just skip this)
  select btrim(coalesce(a.answers->>'intro_answer', '')) into v_intro
  from community_member_answers a where a.member_id = v_row.id;
  if coalesce(v_intro, '') <> '' then
    insert into community_topic_messages (topic_id, sender_id, body)
    values (v_topic_id, v_row.user_id, v_intro);
  end if;

  -- warm note to the new member (LIZ COPY)
  insert into app_notifications (user_id, type, title, body, actor_user_id)
  values (
    v_row.user_id,
    'community_join_approved',
    'you''re in',
    v_community_name || ' let you in. your introduction is already posted, come say hi.',
    v_uid
  );
end;
$$;

revoke all on function public.review_community_join(uuid, boolean, text) from public;
revoke all on function public.review_community_join(uuid, boolean, text) from anon;
grant execute on function public.review_community_join(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. request_community_join_follow_up: genuinely new. Leaves the request
--    pending (this is a question, not a decision) and sends the applicant a
--    leader-authored note. Same auth shape as review_community_join.
-- ---------------------------------------------------------------------------
create or replace function public.request_community_join_follow_up(
  p_member_id uuid,
  p_message text
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_community_name text;
  v_message text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select id, community_id, user_id, status into v_row
  from community_members where id = p_member_id;
  if v_row.id is null then
    raise exception 'That request is gone.';
  end if;
  -- SUPERSEDED by S-03, same note as review_community_join above.
  if not (is_community_leader(v_row.community_id, v_uid)
          or is_admin(v_uid) or has_role(v_uid, 'admin'::app_role)) then
    raise exception 'Not authorized';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'That request was already handled.';
  end if;

  v_message := btrim(coalesce(p_message, ''));
  if v_message = '' or char_length(v_message) > 500 then
    raise exception 'A short follow-up question is required.';
  end if;

  select name into v_community_name from communities where id = v_row.community_id;

  insert into app_notifications (user_id, type, title, body, actor_user_id)
  values (
    v_row.user_id,
    'community_join_follow_up',
    'one more thing',
    v_community_name || ' has a quick follow-up before deciding: ' || v_message,
    v_uid
  );
  -- status is deliberately untouched: still pending either side of this call
end;
$$;

revoke all on function public.request_community_join_follow_up(uuid, text) from public;
revoke all on function public.request_community_join_follow_up(uuid, text) from anon;
grant execute on function public.request_community_join_follow_up(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. in-transaction self-test (never strip on apply)
-- ---------------------------------------------------------------------------
do $$
declare
  v_leader uuid;
  v_joiner uuid;
  v_other uuid;
  v_cid uuid;
  v_member_id uuid;
  v_member_id2 uuid;
  v_raised boolean;
  v_status public.community_member_status;
  v_body text;
  v_count integer;
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

  insert into public.communities (handle, name, created_by, status, join_policy)
  values ('selftest-review-actions', 'Review Actions Selftest', v_leader, 'active', 'approval_required')
  returning id into v_cid;
  insert into public.community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_leader, 'leader', 'active', now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_joiner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.request_to_join_community(v_cid, v_answers);
  reset role;
  select id into v_member_id from public.community_members
  where community_id = v_cid and user_id = v_joiner and status = 'pending';
  if v_member_id is null then
    raise exception 'SELF-TEST FAIL: setup join request did not land pending';
  end if;

  -- 4a. old 2-arg call shape still works (regression: both live clients call
  --     this exact 2-arg form today and must keep working unmodified)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.review_community_join(v_member_id, false);
  reset role;
  select status into v_status from public.community_members where id = v_member_id;
  if v_status <> 'declined' then
    raise exception 'SELF-TEST FAIL: the old 2-arg review_community_join call broke';
  end if;
  select body into v_body from public.app_notifications
  where user_id = v_joiner and type = 'community_join_declined'
  order by created_at desc limit 1;
  if v_body <> 'not this time, and that''s okay. there are more communities to find.' then
    raise exception 'SELF-TEST FAIL: the 2-arg decline did not fall back to the default line';
  end if;

  -- 4b. a leader-authored decline message replaces the default line
  delete from public.community_members where id = v_member_id;
  delete from public.community_member_answers where member_id = v_member_id;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_joiner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.request_to_join_community(v_cid, v_answers);
  reset role;
  select id into v_member_id from public.community_members
  where community_id = v_cid and user_id = v_joiner and status = 'pending';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.review_community_join(v_member_id, false, 'thanks for asking -- we are keeping this one small for now.');
  reset role;
  select body into v_body from public.app_notifications
  where user_id = v_joiner and type = 'community_join_declined'
  order by created_at desc limit 1;
  if v_body <> 'thanks for asking -- we are keeping this one small for now.' then
    raise exception 'SELF-TEST FAIL: the custom decline message did not reach the notification';
  end if;

  -- 4c. an over-length decline message is rejected, nothing half-applied
  delete from public.community_members where id = v_member_id;
  delete from public.community_member_answers where member_id = v_member_id;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_joiner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.request_to_join_community(v_cid, v_answers);
  reset role;
  select id into v_member_id from public.community_members
  where community_id = v_cid and user_id = v_joiner and status = 'pending';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.review_community_join(v_member_id, false, repeat('x', 501));
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: an over-length decline message was accepted';
  end if;
  select status into v_status from public.community_members where id = v_member_id;
  if v_status <> 'pending' then
    raise exception 'SELF-TEST FAIL: a rejected decline call still changed status';
  end if;

  -- 4d. ask-a-follow-up leaves the row pending and notifies the joiner
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.request_community_join_follow_up(v_member_id, 'quick one -- what part of town are you in?');
  reset role;
  select status into v_status from public.community_members where id = v_member_id;
  if v_status <> 'pending' then
    raise exception 'SELF-TEST FAIL: asking a follow-up changed the request status';
  end if;
  if not exists (
    select 1 from public.app_notifications
    where user_id = v_joiner and type = 'community_join_follow_up'
      and body like '%quick one -- what part of town are you in?%'
  ) then
    raise exception 'SELF-TEST FAIL: follow-up notification missing or wrong body';
  end if;

  -- 4e. a non-leader cannot ask a follow-up
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.request_community_join_follow_up(v_member_id, 'let me in');
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a non-leader asked a follow-up';
  end if;

  -- 4f. an already-declined request refuses a follow-up (not pending anymore)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.review_community_join(v_member_id, false);
  v_raised := false;
  begin
    perform public.request_community_join_follow_up(v_member_id, 'too late to ask now');
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a follow-up landed on an already-declined request';
  end if;

  -- cleanup
  select count(*) into v_count from public.communities where id = v_cid;
  delete from public.app_notifications
  where type in ('community_join_request', 'community_join_approved', 'community_join_declined', 'community_join_follow_up')
    and user_id in (v_leader, v_joiner, v_other);
  delete from public.communities where id = v_cid;

  raise notice 'community join review actions self-test passed';
end;
$$;

commit;
