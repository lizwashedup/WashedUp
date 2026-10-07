-- REVIEW ONLY. Isolated creator-page admission consistency candidate.
-- Requires local 030 publication and 080 joining settings. Not deployed.
-- Reuses memberships, private answers, creator projection and the existing
-- finalizer. Separate Intros/main room mapping (D09) is still outstanding;
-- do not call this a complete admission-to-chat release migration.
-- Existing memberships, messages, room identities and preferences are untouched.
-- Legacy open admission is intentionally unchanged until the inherited grants,
-- missing restriction-column and shipped path are reconciled (V-CREATOR-LEGACY-01).
BEGIN;
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.request_to_join_community(uuid,jsonb)'::regprocedure)) <> 'fee4af914172b98dc143af5175d2be5f' THEN RAISE EXCEPTION 'Unexpected request_to_join_community definition; reconcile before applying'; END IF;
 IF md5(pg_get_functiondef('public.finalize_community_join(uuid,uuid,boolean)'::regprocedure)) <> '8324b00abe8208ca427837f7f92a7bc1' THEN RAISE EXCEPTION 'Unexpected finalize_community_join definition; reconcile before applying'; END IF;
 IF md5(pg_get_functiondef('public.review_community_join(uuid,boolean)'::regprocedure)) <> '9da22931ddae5d7ea9442cf2bf2b161a' THEN RAISE EXCEPTION 'Unexpected review_community_join definition; reconcile before applying'; END IF;
 IF md5(pg_get_functiondef('public.get_join_answer_cards(uuid)'::regprocedure)) <> '572aee76adcd33426cc983e331bcf95d' THEN RAISE EXCEPTION 'Unexpected get_join_answer_cards definition; reconcile before applying'; END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.finalize_community_join(p_member_id uuid, p_actor_uid uuid, p_self boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row record;
  v_community_name text;
  v_answers jsonb;
  v_first text;
  v_intro text;
  v_question text;
  v_qfrag text;
  v_area text;
  v_body text;
  v_posted boolean := false;
begin
  -- Same lock order as request/settings/review: community, then membership.
  perform 1 from public.communities where id=(select community_id from public.community_members where id=p_member_id) FOR UPDATE;
  select id, community_id, user_id, status into v_row
  from community_members where id = p_member_id FOR UPDATE;
  if v_row.id is null then
    raise exception 'That membership is gone.';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'That request was already handled.';
  end if;

  select name into v_community_name from communities where id = v_row.community_id;

  update community_members
  set status = 'active', joined_at = now()
  where id = v_row.id;

  -- the system-composed intro card, into the main chat (zip never leaves
  -- community_member_answers; only the area name travels)
  select a.answers into v_answers
  from community_member_answers a where a.member_id = v_row.id;

  v_first := btrim(coalesce(v_answers->>'first_name', ''));
  v_intro := btrim(coalesce(v_answers->>'intro_answer', ''));
  if v_first <> '' and v_intro <> '' then
    v_question := coalesce(
      nullif(btrim(coalesce(v_answers->>'intro_question', '')), ''),
      nullif(btrim(coalesce((select join_intro_question from communities where id = v_row.community_id), '')), ''),
      'introduce yourself. what should this community know about you?'
    );
    v_qfrag := lower(regexp_replace(btrim(v_question), '[?.!]+$', ''));
    select za.area into v_area from zip_areas za where za.zip = v_answers->>'zip';

    v_body := 'this is ' || v_first
      || coalesce(', from ' || v_area, '')
      || '. ' || v_qfrag || ': ' || v_intro
      || case when v_intro ~ '[.!?]$' then '' else '.' end;

    insert into community_broadcasts (community_id, sender_id, body, kind, payload)
    values (
      v_row.community_id,
      v_row.user_id,
      v_body,
      'intro',
      jsonb_build_object(
        'user_id', v_row.user_id,
        'first_name', v_first,
        'area', v_area,
        'question', v_question,
        'answer', v_intro
      )
    );
    v_posted := true;
  end if;

  -- LIZ COPY. p_self = an open joiner letting themselves in; else a leader
  -- approved them. Only claim the intro is posted when it actually is.
  insert into app_notifications (user_id, type, title, body, actor_user_id)
  values (
    v_row.user_id,
    'community_join_approved',
    'you''re in',
    case when p_self
      then 'you''re in at ' || v_community_name || case when v_posted
        then '. your introduction is already posted, come say hi.'
        else '. come say hi.' end
      else v_community_name || case when v_posted
        then ' let you in. your introduction is already posted, come say hi.'
        else ' let you in. come say hi.' end
    end,
    p_actor_uid
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_community_join(p_member_id uuid, p_approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row record;
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
  perform 1 from public.communities where id=v_row.community_id FOR UPDATE;
  select id, community_id, user_id, status into v_row
  from public.community_members where id=p_member_id FOR UPDATE;
  if v_row.id is null then
    raise exception 'That request is gone.';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'That request was already handled.';
  end if;

  if not p_approve then
    -- LIZ COPY
    update community_members set status = 'declined' where id = v_row.id;
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

  -- the activate + intro + you're-in tail, now shared with the open path
  perform finalize_community_join(v_row.id, v_uid, false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_join_answer_cards(p_community_id uuid)
 RETURNS TABLE(member_id uuid, first_name text, last_name text, area text, intro_answer text, guidelines_accepted_at timestamp with time zone, reason_answer text, source_answer text, rules_confirmed boolean, open_question text, open_answer text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    CASE WHEN a.answers ? 'open_question' THEN a.answers->>'open_question' ELSE c.join_open_question END,
    a.answers->>'open_answer'
  from community_member_answers a
  left join zip_areas za on za.zip = a.answers->>'zip'
  join communities c on c.id = a.community_id
  where a.community_id = p_community_id;
end;
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
