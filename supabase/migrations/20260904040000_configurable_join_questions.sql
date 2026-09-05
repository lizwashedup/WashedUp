-- DRAFT: DO NOT APPLY WITHOUT JOSH'S WORD.
-- ============================================================================
-- Liz decision #11, 2026-09-03 (WashedUp_Responses_to_Josh_21_Decisions):
-- "Allow leaders to configure up to five questions rather than requiring all
-- five for every community: the existing public introduction, a private
-- reason for joining, a private source question, a rules-confirmation
-- question only when the community has a genuine eligibility restriction,
-- and one optional open-ended question. The same authorized people should
-- review the answers as they do today. After approval, the public
-- introduction should enter the community's single main chat; the remaining
-- answers stay private to the reviewers." Full context:
-- clients/washed-up/LIZ-OPEN-QUESTIONS.md item 11.
--
-- Additive and reversible: adds four columns to communities and extends the
-- whitelist logic inside the two existing join RPCs
-- (request_to_join_community, get_join_answer_cards). No new tables, no
-- signature changes -- both RPCs keep the exact same arguments they have in
-- prod today. Every existing call that never sets these columns behaves
-- byte-identically to today: request_to_join_community stores exactly the
-- same 6 keys it always has, and get_join_answer_cards returns the same 5
-- columns it always has, now with 5 more that are simply null/false for
-- every community that has not opted in. Gated app-side by
-- CONFIGURABLE_JOIN_QUESTIONS_ENABLED (constants/FeatureFlags.ts) -- do not
-- flip that flag on for a real build until this migration is reviewed and
-- applied to prod.
--
-- The intro-to-chat behavior in review_community_join() is DELIBERATELY NOT
-- TOUCHED here: it already posts only community_member_answers.answers's
-- intro_answer key into the introductions topic and nothing else, which is
-- already exactly Liz's rule ("only the public introduction enters chat,
-- everything else stays private to the reviewers") for any additional keys
-- this migration adds to that same jsonb blob -- the new keys are simply
-- never read by that function, so they can never leak into chat by
-- construction, not by a check that could later be missed.
--
-- Rules-confirmation question (slot 4) and the eligibility-restriction
-- concept it depends on: this repo already has exactly one such concept,
-- communities.restricted_gender (20260901080000_gender_restricted_communities.sql,
-- also DRAFT, not applied). Deliberately NOT hard-wired as a SQL dependency
-- between these two independent drafts -- join_ask_rules_confirm is stored
-- here as a plain, ungated boolean column, the same shape as the other two
-- toggles. The actual "only offer this when a genuine restriction exists"
-- rule is enforced app-side: app/creator/join-gate.tsx only renders the
-- toggle once lib/creatorMode.ts's getCommunityRestrictedGender() reads back
-- non-null for that community -- the same self-flipping double-gate shape
-- already used for join_policy/discoverable elsewhere in this repo. This
-- keeps the two drafts independently applicable in either order; a real
-- SQL-level FK/CHECK tying join_ask_rules_confirm to restricted_gender being
-- non-null was considered and rejected for that reason.
--
-- No self-test block: this sandbox has no live Postgres to run one against
-- (same limitation noted in 20260904000000's header). Needs a real
-- local/staging pass -- checklist at the bottom -- before this is reviewed
-- for prod.
-- ============================================================================

do $$
begin
  if to_regclass('public.communities') is null then
    raise exception 'configurable-join-questions dependency missing: public.communities';
  end if;
  if to_regprocedure('public.request_to_join_community(uuid,jsonb)') is null then
    raise exception 'configurable-join-questions dependency missing: public.request_to_join_community(uuid,jsonb) (20260706100500_join_flow.sql)';
  end if;
  if to_regprocedure('public.get_join_answer_cards(uuid)') is null then
    raise exception 'configurable-join-questions dependency missing: public.get_join_answer_cards(uuid) (20260714223943_answers_withhold_proposal_42.sql)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. communities: three leader toggles plus one leader-authored question.
--    All default to "off"/null so every existing community, and every
--    community created before a leader ever visits the join-gate screen,
--    behaves exactly as it does today.
-- ---------------------------------------------------------------------------

alter table public.communities
  add column if not exists join_ask_reason boolean not null default false,
  add column if not exists join_ask_source boolean not null default false,
  add column if not exists join_ask_rules_confirm boolean not null default false,
  add column if not exists join_open_question text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.communities'::regclass
      and conname = 'communities_join_open_question_length_check'
  ) then
    alter table public.communities
      add constraint communities_join_open_question_length_check
      check (join_open_question is null or char_length(join_open_question) <= 200) not valid;
  end if;
end $$;

alter table public.communities
  validate constraint communities_join_open_question_length_check;

comment on column public.communities.join_ask_reason is
  'Liz decision #11 (2026-09-03): leader toggle for the private "why do you want to join" question. Off by default (every existing row). Written only by lib/creatorMode.ts''s updateJoinQuestionsConfig() through the existing leader-scoped communities_update RLS policy -- no new RPC, the same write path join_welcome_message/join_intro_question/guidelines_url already use.';
comment on column public.communities.join_ask_source is
  'Liz decision #11 (2026-09-03): leader toggle for the private "how did you hear about this" question. Off by default. Same write path as join_ask_reason.';
comment on column public.communities.join_ask_rules_confirm is
  'Liz decision #11 (2026-09-03): leader toggle for a rules-confirmation question. Off by default. Liz''s condition ("only when the community has a genuine eligibility restriction") is enforced app-side, not by a SQL constraint on this column -- see the header comment above for why. A community with no restriction can technically have this column set true only via a direct DB write outside the app; the shipped UI never offers the toggle unless communities.restricted_gender already reads back non-null for that community.';
comment on column public.communities.join_open_question is
  'Liz decision #11 (2026-09-03): the leader''s own custom open-ended question. NULL or empty = the fifth question is off, the same "presence is the toggle" pattern join_intro_question already uses for the first one. Non-empty text is both the on/off switch and the prompt a joiner sees.';

-- ---------------------------------------------------------------------------
-- 2. request_to_join_community(): same signature (uuid, jsonb), same
--    required-field checks for the 6 keys that exist today, unchanged. Only
--    addition: four more keys are validated and stored, each ONLY when the
--    target community has that slot turned on -- a community that never
--    enables any of them stores exactly today's 6-key object, byte-identical.
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

  select id, name, status, join_ask_reason, join_ask_source, join_ask_rules_confirm, join_open_question
  into v_community
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

  -- Liz decision #11: each of these only applies -- and is only required --
  -- when THIS community has that slot turned on.
  if v_community.join_ask_reason and (
       coalesce(btrim(p_answers->>'reason_answer'), '') = ''
       or char_length(p_answers->>'reason_answer') > 1000
     ) then
    raise exception 'Tell us why you want to join.';
  end if;
  if v_community.join_ask_source and (
       coalesce(btrim(p_answers->>'source_answer'), '') = ''
       or char_length(p_answers->>'source_answer') > 500
     ) then
    raise exception 'Tell us how you heard about this community.';
  end if;
  if v_community.join_ask_rules_confirm
     and coalesce((p_answers->>'rules_confirmed')::boolean, false) is not true then
    raise exception 'Confirming you meet the membership requirement is required.';
  end if;
  if coalesce(btrim(v_community.join_open_question), '') <> '' and (
       coalesce(btrim(p_answers->>'open_answer'), '') = ''
       or char_length(p_answers->>'open_answer') > 1000
     ) then
    raise exception 'That answer is required.';
  end if;

  -- whitelist: store exactly the doc 09 keys, nothing else, plus whichever
  -- of the four new keys this community actually asks for
  v_stored := jsonb_build_object(
    'first_name', btrim(p_answers->>'first_name'),
    'last_name', btrim(p_answers->>'last_name'),
    'email', btrim(p_answers->>'email'),
    'zip', btrim(p_answers->>'zip'),
    'intro_answer', btrim(p_answers->>'intro_answer'),
    'guidelines_accepted_at', now()
  );
  if v_community.join_ask_reason then
    v_stored := v_stored || jsonb_build_object('reason_answer', btrim(p_answers->>'reason_answer'));
  end if;
  if v_community.join_ask_source then
    v_stored := v_stored || jsonb_build_object('source_answer', btrim(p_answers->>'source_answer'));
  end if;
  if v_community.join_ask_rules_confirm then
    v_stored := v_stored || jsonb_build_object('rules_confirmed', true);
  end if;
  if coalesce(btrim(v_community.join_open_question), '') <> '' then
    v_stored := v_stored || jsonb_build_object('open_answer', btrim(p_answers->>'open_answer'));
  end if;

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
-- 3. get_join_answer_cards(): the leader-facing projection. Its RETURNS
--    TABLE shape is changing (5 new output columns), which Postgres will not
--    let CREATE OR REPLACE do in place -- same reason 20260901080000's
--    create_community() change used DROP-then-CREATE, not a plain REPLACE.
-- ---------------------------------------------------------------------------

drop function if exists public.get_join_answer_cards(uuid);

create function public.get_join_answer_cards(
  p_community_id uuid
)
returns table (
  member_id uuid,
  first_name text,
  last_name text,
  area text,
  intro_answer text,
  guidelines_accepted_at timestamptz,
  reason_answer text,
  source_answer text,
  rules_confirmed boolean,
  open_question text,
  open_answer text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not is_community_leader(p_community_id, auth.uid()) then
    raise exception 'Not authorized';
  end if;
  return query
  select
    a.member_id,
    a.answers->>'first_name',
    a.answers->>'last_name',
    za.area,
    a.answers->>'intro_answer',
    (a.answers->>'guidelines_accepted_at')::timestamptz,
    a.answers->>'reason_answer',
    a.answers->>'source_answer',
    (a.answers->>'rules_confirmed')::boolean,
    c.join_open_question,
    a.answers->>'open_answer'
  from community_member_answers a
  left join zip_areas za on za.zip = a.answers->>'zip'
  join communities c on c.id = a.community_id
  where a.community_id = p_community_id;
end;
$function$;

revoke all on function public.get_join_answer_cards(uuid) from public;
revoke all on function public.get_join_answer_cards(uuid) from anon;
grant execute on function public.get_join_answer_cards(uuid) to authenticated;

-- Needs a real local/staging pass before this is reviewed for prod:
--   1. A community with every new toggle off still stores and returns
--      exactly today's 6-key answers / 5-column card shape (regression
--      check against the pre-migration behavior).
--   2. Turning on join_ask_reason/join_ask_source/join_ask_rules_confirm and
--      setting join_open_question, then joining: request_to_join_community
--      rejects a missing answer for each enabled slot, and stores all of
--      them once provided; a community that leaves a slot off still rejects
--      nothing extra and stores nothing extra for that slot.
--   3. get_join_answer_cards returns the new fields to a leader, still
--      refuses a plain member (existing proposal-42 probe 4 behavior,
--      unchanged by this migration), and still omits email/raw zip.
--   4. review_community_join still posts ONLY intro_answer into the
--      introductions topic even when the other four answers are present on
--      the same pending request.
