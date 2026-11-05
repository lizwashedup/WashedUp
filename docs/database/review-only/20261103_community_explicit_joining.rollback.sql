-- REVIEW ONLY. Restore admission behavior; retain all memberships, choices and creation receipts.
BEGIN;
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.request_to_join_community(uuid,jsonb)'::regprocedure)) <> '13b2cd62340a704dc49e086324c72aae' THEN RAISE EXCEPTION 'request_to_join_community changed; review rollback'; END IF;
 IF md5(pg_get_functiondef('public.set_community_join_policy(uuid,text)'::regprocedure)) <> '0fccd96c8ca35fa55e2e518aaf501394' THEN RAISE EXCEPTION 'set_community_join_policy changed; review rollback'; END IF;
 IF to_regprocedure('public.community_joining_is_open(uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.community_joining_is_open(uuid)'))) <> '703f848424242adab9687c4607b8bd61' THEN RAISE EXCEPTION 'community_joining_is_open changed; review rollback'; END IF;
 IF to_regprocedure('public.get_community_joining_options(uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.get_community_joining_options(uuid)'))) <> 'bf4c7009c1649be9f17fafcaa2df2229' THEN RAISE EXCEPTION 'get_community_joining_options changed; review rollback'; END IF;
 IF to_regprocedure('public.create_community_with_joining(uuid,text,text,text,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.create_community_with_joining(uuid,text,text,text,text,text)'))) <> '538460a654831f3262babe498fa3a5ab' THEN RAISE EXCEPTION 'create_community_with_joining changed; review rollback'; END IF;
 IF to_regprocedure('public.get_community_creation_attempt(uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.get_community_creation_attempt(uuid)'))) <> 'e99aea4f995c88bbdea9c51eedc42d42' THEN RAISE EXCEPTION 'get_community_creation_attempt changed; review rollback'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.request_to_join_community(p_community_id uuid, p_answers jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select id, name, status, join_policy, join_intro_question, creator_page_join_settings_version, join_ask_reason, join_ask_source, join_ask_rules_confirm, join_open_question
  into v_community
  from communities where id = p_community_id AND public.creator_community_is_visible(id) FOR UPDATE;
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
    'intro_question', coalesce(nullif(btrim(v_community.join_intro_question), ''), 'introduce yourself. what should this community know about you?'),
    'open_question', nullif(btrim(v_community.join_open_question), ''),
    'joining_settings_version', v_community.creator_page_join_settings_version,
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
  where community_id = p_community_id and user_id = v_uid FOR UPDATE;

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

  -- New published pages have verified page-audience guards. Reuse the
  -- existing activation/notification path only after all answers are stored.
  -- Legacy page admission remains unchanged pending its separate authority audit.
  if v_community.join_policy = 'open' AND EXISTS (
    SELECT 1 FROM public.creator_page_publications WHERE page_id=p_community_id AND page_kind='community'
  ) then
    perform public.finalize_community_join(v_member_id, v_uid, true);
    return;
  end if;

  -- tell every active leader and co-leader (LIZ COPY)
  v_first := v_stored->>'first_name';
  IF EXISTS(SELECT 1 FROM public.creator_page_publications WHERE page_id=p_community_id AND page_kind='community') THEN
    PERFORM public.emit_creator_join_notice(v_member_id,'request',v_uid,'someone wants in',v_first || ' asked to join ' || v_community.name || '. their introduction is waiting for you.');
  ELSE
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
  END IF;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_community_join_policy(p_community_id uuid, p_join_policy text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_ok boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if p_join_policy not in ('approval_required', 'open') then
    raise exception 'Unknown join policy %', coalesce(p_join_policy, '(none)');
  end if;
  select (
      is_community_leader(p_community_id, v_uid)
      or is_admin(v_uid)
      or has_role(v_uid, 'admin'::app_role)
    )
    into v_ok;
  if v_ok is distinct from true then
    raise exception 'Not the leader of this community';
  end if;
  update public.communities set join_policy = p_join_policy where id = p_community_id;
end;
$function$
;
DROP FUNCTION public.get_community_joining_options(uuid);
DROP FUNCTION public.create_community_with_joining(uuid,text,text,text,text,text);
-- Keep the read-only, account-scoped receipt lookup for completed creations.
COMMIT;
