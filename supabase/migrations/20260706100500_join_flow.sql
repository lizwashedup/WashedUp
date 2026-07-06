-- ============================================================================
-- join flow (doc 09 popup) + review-notes privacy rider. Proposal doc 14 v2,
-- Cowork review round 1 fixes in (private answers table, declined status,
-- review_notes null-out, decline note, Liz calls a/b/c). PART A = the
-- 'declined' enum value, its own prior migration (55P04).
-- APPLIED to prod 2026-07-06 after a full-fidelity ROLLBACK dry-run passed
-- every assertion including 8j; all in-transaction self-tests passed on
-- apply; post-apply state verified (3 gate cols, 2 tables, 3 fns, CHECK 29,
-- enum 6, zero test leftovers, existing rows untouched).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. join gate settings on communities (leader-set, doc 09)
--    Leaders write these directly through the existing communities_update
--    RLS policy; no new write path needed.
-- ---------------------------------------------------------------------------
alter table public.communities
  add column join_welcome_message text
    check (join_welcome_message is null or char_length(join_welcome_message) between 1 and 1000),
  add column join_intro_question text
    check (join_intro_question is null or char_length(join_intro_question) between 1 and 200),
  add column guidelines_url text
    check (guidelines_url is null or guidelines_url ~* '^https?://');

comment on column public.communities.join_welcome_message is
  'Leader-written welcome shown at the top of the join popup, in their voice.';
comment on column public.communities.join_intro_question is
  'Leader-set intro question; the answer becomes the joiner''s introduction in chat on approval.';
comment on column public.communities.guidelines_url is
  'Link behind the required guidelines checkbox in the join popup.';

-- ---------------------------------------------------------------------------
-- 2. private join answers (Cowork must-fix)
--    Email and zip are leader-eyes-only. The membership row carries no
--    answers; this table does, readable by the person themselves, the
--    community's leaders, and admins. Writes happen only inside the
--    security-definer RPCs (no insert/update policy for regular roles).
-- ---------------------------------------------------------------------------
create table public.community_member_answers (
  member_id uuid primary key references public.community_members(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index community_member_answers_community_idx
  on public.community_member_answers (community_id);

alter table public.community_member_answers enable row level security;

create policy community_member_answers_select
  on public.community_member_answers
  for select using (
    user_id = (select auth.uid())
    or is_community_leader(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
-- deliberately NO insert/update policy for authenticated: the RPCs are the
-- only write path. Admins can delete for moderation cleanup.
create policy community_member_answers_admin_delete
  on public.community_member_answers
  for delete using (is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role));

-- explicit (not default-privileges-dependent): reads for signed-in users,
-- filtered hard by the select policy above
grant select on public.community_member_answers to authenticated;

-- migrate any answers off the membership rows (verified 0 rows today; kept
-- for correctness) and stop the leak permanently
insert into public.community_member_answers (member_id, community_id, user_id, answers)
select id, community_id, user_id, join_answers
from public.community_members
where join_answers is not null;

update public.community_members set join_answers = null
where join_answers is not null;

comment on column public.community_members.join_answers is
  'DEPRECATED 2026-07-06: answers live in community_member_answers (self/leader/admin RLS). Column retained under the additive rule; no longer written (it leaked email+zip to fellow members).';

-- ---------------------------------------------------------------------------
-- 3. the default topic seam (where introductions land)
-- ---------------------------------------------------------------------------
alter table public.community_topics
  add column is_default boolean not null default false;

create unique index community_topics_one_default
  on public.community_topics (community_id) where is_default;

comment on column public.community_topics.is_default is
  'The community''s introductions topic, lazily created on first approval. One per community.';

-- ---------------------------------------------------------------------------
-- 4. app_notifications type CHECK: strict superset (+3 values)
--    List below = the LIVE 26-value constraint read from prod 2026-07-06.
--    The guard asserts the pre-change count so silent drift fails loudly.
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
  if (length(v_def) - length(replace(v_def, '::text', ''))) / length('::text') <> 26 then
    raise exception 'SELF-TEST FAIL: live type CHECK is not the expected 26 values; re-read prod before applying (drift since 2026-07-06)';
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
    'community_join_request', 'community_join_approved', 'community_join_declined'
  ]));

-- ---------------------------------------------------------------------------
-- 5. request_to_join_community: the single write path for join requests.
--    SECURITY DEFINER because (a) required-answer validation must be
--    server-side, (b) the answers table takes writes only here, (c) a 'left'
--    row flipping back to pending is a self-serve UPDATE that member RLS
--    deliberately does not allow, (d) leader notifications are inserts for
--    other users.
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
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select id, name, status into v_community
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

  -- tell every active leader and co-leader (LIZ COPY)
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
-- 6. review_community_join: approve or decline, leader-only.
--    SECURITY DEFINER so approval can post the intro AS the joiner into the
--    introductions topic and subscribe them, which RLS correctly forbids the
--    leader from doing directly.
-- ---------------------------------------------------------------------------
create or replace function public.review_community_join(
  p_member_id uuid,
  p_approve boolean
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
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select id, community_id, user_id, status into v_row
  from community_members where id = p_member_id;
  if v_row.id is null then
    raise exception 'That request is gone.';
  end if;
  if not (is_community_leader(v_row.community_id, v_uid)
          or is_admin(v_uid) or has_role(v_uid, 'admin'::app_role)) then
    raise exception 'Not authorized';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'That request was already handled.';
  end if;

  select name into v_community_name from communities where id = v_row.community_id;

  if not p_approve then
    -- decline: distinct status (Cowork small 1) + a kind note (Liz call a)
    update community_members set status = 'declined' where id = v_row.id;
    -- LIZ COPY
    insert into app_notifications (user_id, type, title, body, actor_user_id)
    values (
      v_row.user_id,
      'community_join_declined',
      'about your request',
      'not this time, and that''s okay. there are more communities to find.',
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

revoke all on function public.review_community_join(uuid, boolean) from public;
revoke all on function public.review_community_join(uuid, boolean) from anon;
grant execute on function public.review_community_join(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. housekeeping rider: truly private review notes (doc 00 open question 3b)
--    New admin-only table; the review RPC writes there and STOPS writing
--    operator_grants.review_notes. The old column stays (additive rule) but
--    is nulled out after the copy (Cowork small 2) so nothing remains
--    row-readable by applicants.
-- ---------------------------------------------------------------------------
create table public.operator_grant_review_notes (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.operator_grants(id) on delete cascade,
  notes text not null check (char_length(notes) between 1 and 4000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index operator_grant_review_notes_grant_idx
  on public.operator_grant_review_notes (grant_id, created_at desc);

alter table public.operator_grant_review_notes enable row level security;

create policy operator_grant_review_notes_admin_all
  on public.operator_grant_review_notes
  for all
  using (is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role))
  with check (is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role));

-- copy the notes written so far, then clear the readable column
insert into public.operator_grant_review_notes (grant_id, notes, created_by, created_at)
select id, review_notes, reviewed_by, coalesce(reviewed_at, now())
from public.operator_grants
where review_notes is not null;

update public.operator_grants set review_notes = null
where review_notes is not null;

comment on column public.operator_grants.review_notes is
  'DEPRECATED 2026-07-06: internal notes now live in operator_grant_review_notes (admin-only RLS). Column retained under the additive rule; nulled and no longer written.';

-- same signature, one change: p_notes goes to the private table
create or replace function public.admin_review_operator_grant(
  p_grant_id uuid,
  p_outcome public.operator_grant_status,
  p_notes text default null,
  p_applicant_message text default null
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_user uuid;
  v_track public.operator_track;
  v_title text;
  v_body text;
begin
  if not (is_admin(auth.uid()) or has_role(auth.uid(), 'admin'::app_role)) then
    raise exception 'Not authorized';
  end if;
  if p_outcome not in ('in_review', 'needs_more_info', 'approved', 'declined', 'revoked') then
    raise exception 'Invalid review outcome';
  end if;

  update operator_grants
  set status = p_outcome,
      applicant_message = p_applicant_message,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_grant_id
  returning user_id, track into v_user, v_track;

  if v_user is null then
    raise exception 'Application not found';
  end if;

  -- internal note lands in the admin-only table, never on the grant row
  if p_notes is not null and btrim(p_notes) <> '' then
    insert into operator_grant_review_notes (grant_id, notes, created_by)
    values (p_grant_id, btrim(p_notes), auth.uid());
  end if;

  -- warm in-app note to the applicant (copy is a stub, Liz edits).
  -- ONLY p_applicant_message ever reaches the applicant; p_notes never does.
  if p_outcome = 'approved' then
    v_title := 'you''re in';
    v_body := coalesce(p_applicant_message || ' ', '')
      || 'a real person read your application and said yes. welcome to the creators. we''ll reach out to get you set up.';
  elsif p_outcome = 'needs_more_info' then
    v_title := 'one thing before we say yes';
    v_body := coalesce(p_applicant_message || ' ', '') || 'update your application and send it back in.';
  elsif p_outcome = 'declined' then
    v_title := 'about your application';
    v_body := coalesce(p_applicant_message || ' ', '') || 'not the right fit right now, and the door stays open. you can apply again anytime.';
  end if;

  if v_title is not null then
    insert into app_notifications (user_id, type, title, body)
    values (v_user, 'operator_grant', v_title, v_body);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. in-transaction self-tests (never strip on apply)
-- ---------------------------------------------------------------------------
do $$
declare
  v_leader uuid;
  v_joiner uuid;
  v_member2 uuid;
  v_cid uuid;
  v_member_id uuid;
  v_topic_id uuid;
  v_raised boolean;
  v_count integer;
  v_answers jsonb := jsonb_build_object(
    'first_name', 'Sage', 'last_name', 'Selftest',
    'email', 'sage@example.com', 'zip', '90026',
    'intro_answer', 'my go-to taco spot is the one on the corner.',
    'guidelines_accepted', true
  );
begin
  -- three non-admin users (phase 1 pattern, plus one for the RLS probe)
  select id into v_leader from auth.users u
  where not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_joiner from auth.users u
  where u.id <> v_leader
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_member2 from auth.users u
  where u.id not in (v_leader, v_joiner)
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  if v_leader is null or v_joiner is null or v_member2 is null then
    raise exception 'SELF-TEST FAIL: needs three existing non-admin users';
  end if;

  insert into public.communities (handle, name, created_by, status, join_intro_question, guidelines_url)
  values ('selftest-join-flow', 'Join Flow Selftest', v_leader, 'active',
          'what is your go-to taco spot?', 'https://washedup.app/guidelines')
  returning id into v_cid;
  insert into public.community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_leader, 'leader', 'active', now());
  -- a second plain active member, the would-be snoop for the RLS probe
  insert into public.community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_member2, 'member', 'active', now());

  -- 8a. missing answers rejected
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_joiner, 'role', 'authenticated')::text, true);
  v_raised := false;
  begin
    perform public.request_to_join_community(v_cid, v_answers - 'zip');
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: missing zip was accepted';
  end if;

  -- 8b. guidelines checkbox required
  v_raised := false;
  begin
    perform public.request_to_join_community(v_cid, v_answers || '{"guidelines_accepted": false}'::jsonb);
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: unaccepted guidelines were accepted';
  end if;

  -- 8c. valid request: pending row with NO answers on it, private answers row
  --     with whitelisted keys, leader notified
  perform public.request_to_join_community(v_cid, v_answers || '{"sneaky_extra": "dropped"}'::jsonb);
  select id into v_member_id from public.community_members
  where community_id = v_cid and user_id = v_joiner
    and status = 'pending' and join_answers is null;
  if v_member_id is null then
    raise exception 'SELF-TEST FAIL: pending row missing or still carrying answers';
  end if;
  if not exists (select 1 from public.community_member_answers
                 where member_id = v_member_id
                   and answers->>'zip' = '90026'
                   and answers ? 'guidelines_accepted_at'
                   and not (answers ? 'sneaky_extra')) then
    raise exception 'SELF-TEST FAIL: private answers row wrong or missing';
  end if;
  select count(*) into v_count from public.app_notifications
  where user_id = v_leader and type = 'community_join_request' and actor_user_id = v_joiner;
  if v_count <> 1 then
    raise exception 'SELF-TEST FAIL: leader join-request notification missing';
  end if;

  -- 8d. THE MUST-FIX PROBE: a fellow member cannot read the answers; the
  --     joiner and the leader can. Runs under the real authenticated role so
  --     RLS is actually enforced (superuser would bypass it).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.community_member_answers
  where member_id = v_member_id;
  if v_count <> 0 then
    reset role;
    raise exception 'SELF-TEST FAIL: a fellow member can read private join answers';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_joiner, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.community_member_answers
  where member_id = v_member_id;
  if v_count <> 1 then
    reset role;
    raise exception 'SELF-TEST FAIL: the joiner cannot read their own answers';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.community_member_answers
  where member_id = v_member_id;
  if v_count <> 1 then
    reset role;
    raise exception 'SELF-TEST FAIL: the leader cannot read join answers';
  end if;
  -- and the snoop cannot write either (no policy -> RLS refuses)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member2, 'role', 'authenticated')::text, true);
  v_raised := false;
  begin
    update public.community_member_answers set answers = '{}'::jsonb
    where member_id = v_member_id;
    if not found then v_raised := true; end if; -- zero rows touched = blocked
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a fellow member overwrote private answers';
  end if;

  -- 8e. double-request blocked
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_joiner, 'role', 'authenticated')::text, true);
  v_raised := false;
  begin
    perform public.request_to_join_community(v_cid, v_answers);
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: duplicate pending request was accepted';
  end if;

  -- 8f. a non-leader cannot review
  v_raised := false;
  begin
    perform public.review_community_join(v_member_id, true);
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: the joiner reviewed their own request';
  end if;

  -- 8g. leader approves: active + default topic + membership + intro posted + note
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  perform public.review_community_join(v_member_id, true);
  if not exists (select 1 from public.community_members
                 where id = v_member_id and status = 'active' and joined_at is not null) then
    raise exception 'SELF-TEST FAIL: approval did not activate the member';
  end if;
  select id into v_topic_id from public.community_topics
  where community_id = v_cid and is_default and name = 'introductions';
  if v_topic_id is null then
    raise exception 'SELF-TEST FAIL: introductions topic missing after approval';
  end if;
  if not exists (select 1 from public.community_topic_members
                 where topic_id = v_topic_id and user_id = v_joiner and notifications_on) then
    raise exception 'SELF-TEST FAIL: joiner not subscribed to introductions';
  end if;
  if not exists (select 1 from public.community_topic_messages
                 where topic_id = v_topic_id and sender_id = v_joiner
                   and body = 'my go-to taco spot is the one on the corner.') then
    raise exception 'SELF-TEST FAIL: intro answer did not post as the joiner';
  end if;
  if not exists (select 1 from public.app_notifications
                 where user_id = v_joiner and type = 'community_join_approved') then
    raise exception 'SELF-TEST FAIL: approval notification missing';
  end if;

  -- 8h. already-handled request refuses a second review
  v_raised := false;
  begin
    perform public.review_community_join(v_member_id, false);
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: an already-approved request was re-reviewed';
  end if;

  -- 8i. leaving then re-requesting flips the same row back to pending
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_joiner, 'role', 'authenticated')::text, true);
  perform public.leave_community(v_cid);
  perform public.request_to_join_community(v_cid, v_answers);
  if not exists (select 1 from public.community_members
                 where id = v_member_id and status = 'pending' and joined_at is null) then
    raise exception 'SELF-TEST FAIL: rejoin after leaving did not go back to pending';
  end if;

  -- 8j. decline sets 'declined' (not removed), sends the kind note, and a
  --     declined person cannot re-request (Liz call b: stays blocked)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  perform public.review_community_join(v_member_id, false);
  if not exists (select 1 from public.community_members
                 where id = v_member_id and status = 'declined') then
    raise exception 'SELF-TEST FAIL: decline did not set the declined status';
  end if;
  if not exists (select 1 from public.app_notifications
                 where user_id = v_joiner and type = 'community_join_declined') then
    raise exception 'SELF-TEST FAIL: decline notification missing';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_joiner, 'role', 'authenticated')::text, true);
  v_raised := false;
  begin
    perform public.request_to_join_community(v_cid, v_answers);
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a declined member re-requested';
  end if;

  -- 8k. anon blocked on both RPCs (the default-privileges gotcha)
  if has_function_privilege('anon', 'public.request_to_join_community(uuid, jsonb)', 'execute') then
    raise exception 'SELF-TEST FAIL: anon can execute request_to_join_community';
  end if;
  if has_function_privilege('anon', 'public.review_community_join(uuid, boolean)', 'execute') then
    raise exception 'SELF-TEST FAIL: anon can execute review_community_join';
  end if;

  -- 8l. review-notes privacy: policy present and the old column is clean
  select count(*) into v_count from pg_policies
  where schemaname = 'public' and tablename = 'operator_grant_review_notes';
  if v_count < 1 then
    raise exception 'SELF-TEST FAIL: operator_grant_review_notes has no RLS policy';
  end if;
  if exists (select 1 from public.operator_grants where review_notes is not null) then
    raise exception 'SELF-TEST FAIL: review_notes column not cleaned after backfill';
  end if;

  -- cleanup (notifications, then the community cascades the rest)
  delete from public.app_notifications
  where type in ('community_join_request', 'community_join_approved', 'community_join_declined')
    and user_id in (v_leader, v_joiner, v_member2);
  delete from public.communities where id = v_cid;

  raise notice 'join flow self-test passed';
end;
$$;

commit;
