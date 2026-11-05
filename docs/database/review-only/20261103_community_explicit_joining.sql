-- REVIEW ONLY. Not deployed. Requires separate release verification.
-- Preserves legacy approval without rewriting existing communities or memberships.
-- New Open choices reuse the existing finalizer, eligibility triggers and private-answer rules.
BEGIN;
DO $guard$ BEGIN
 IF to_regprocedure('public.create_community(text,text,text,text,text,text)') IS NULL OR md5(pg_get_functiondef('public.create_community(text,text,text,text,text,text)'::regprocedure)) NOT IN ('c7c87393c49cbf5b99e3d67a34cf95fe') THEN RAISE EXCEPTION 'create_community changed; inspect current definition'; END IF;
 IF to_regprocedure('public.request_to_join_community(uuid,jsonb)') IS NULL OR md5(pg_get_functiondef('public.request_to_join_community(uuid,jsonb)'::regprocedure)) NOT IN ('a6263e4f97103a8a224b278eaf0b3524','13b2cd62340a704dc49e086324c72aae') THEN RAISE EXCEPTION 'request_to_join_community changed; inspect current definition'; END IF;
 IF to_regprocedure('public.set_community_join_policy(uuid,text)') IS NULL OR md5(pg_get_functiondef('public.set_community_join_policy(uuid,text)'::regprocedure)) NOT IN ('4edcb0aadefd3e0ef19a5a8737c69f82','0fccd96c8ca35fa55e2e518aaf501394') THEN RAISE EXCEPTION 'set_community_join_policy changed; inspect current definition'; END IF;
 IF to_regprocedure('public.finalize_community_join(uuid,uuid,boolean)') IS NULL OR md5(pg_get_functiondef('public.finalize_community_join(uuid,uuid,boolean)'::regprocedure)) NOT IN ('b1a3efad8d89c7b53f9a898b0c486058') THEN RAISE EXCEPTION 'finalize_community_join changed; inspect current definition'; END IF;
 IF to_regprocedure('public.creator_page_member_eligibility_guard()') IS NULL OR md5(pg_get_functiondef('public.creator_page_member_eligibility_guard()'::regprocedure)) NOT IN ('816580c9b006b1571db1673cec32cbf2') THEN RAISE EXCEPTION 'creator_page_member_eligibility_guard changed; inspect current definition'; END IF;
 IF to_regprocedure('public.creator_community_is_visible(uuid)') IS NULL OR md5(pg_get_functiondef('public.creator_community_is_visible(uuid)'::regprocedure)) NOT IN ('f8b427f7f67d2f16eb4294b6a56b8d6a') THEN RAISE EXCEPTION 'creator_community_is_visible changed; inspect current definition'; END IF;
 IF to_regprocedure('public.is_community_leader(uuid,uuid)') IS NULL OR md5(pg_get_functiondef('public.is_community_leader(uuid,uuid)'::regprocedure)) NOT IN ('d9a2d97a0ef34d456087e6df78a8c73d') THEN RAISE EXCEPTION 'is_community_leader changed; inspect current definition'; END IF;
 IF to_regprocedure('public.creator_page_join_settings_revision()') IS NULL OR md5(pg_get_functiondef('public.creator_page_join_settings_revision()'::regprocedure)) NOT IN ('4a1ae5d2698f33a026be65acbb998dd8') THEN RAISE EXCEPTION 'creator_page_join_settings_revision changed; inspect current definition'; END IF;
 IF to_regprocedure('public.community_joining_is_open(uuid)') IS NOT NULL AND md5(pg_get_functiondef(to_regprocedure('public.community_joining_is_open(uuid)'))) <> '703f848424242adab9687c4607b8bd61' THEN RAISE EXCEPTION 'community_joining_is_open already exists with a different definition'; END IF;
 IF to_regprocedure('public.get_community_joining_options(uuid)') IS NOT NULL AND md5(pg_get_functiondef(to_regprocedure('public.get_community_joining_options(uuid)'))) <> 'bf4c7009c1649be9f17fafcaa2df2229' THEN RAISE EXCEPTION 'get_community_joining_options already exists with a different definition'; END IF;
 IF to_regprocedure('public.create_community_with_joining(uuid,text,text,text,text,text)') IS NOT NULL AND md5(pg_get_functiondef(to_regprocedure('public.create_community_with_joining(uuid,text,text,text,text,text)'))) <> '538460a654831f3262babe498fa3a5ab' THEN RAISE EXCEPTION 'create_community_with_joining already exists with a different definition'; END IF;
 IF to_regprocedure('public.get_community_creation_attempt(uuid)') IS NOT NULL AND md5(pg_get_functiondef(to_regprocedure('public.get_community_creation_attempt(uuid)'))) <> 'e99aea4f995c88bbdea9c51eedc42d42' THEN RAISE EXCEPTION 'get_community_creation_attempt already exists with a different definition'; END IF;
 IF to_regclass('public.community_joining_choices') IS NOT NULL AND obj_description(to_regclass('public.community_joining_choices'),'pg_class') IS DISTINCT FROM 'WashedUp explicit joining v1; 20261103' THEN RAISE EXCEPTION 'community_joining_choices already exists; inspect before migration'; END IF;
 IF to_regclass('public.community_creation_attempts') IS NOT NULL AND obj_description(to_regclass('public.community_creation_attempts'),'pg_class') IS DISTINCT FROM 'WashedUp explicit joining v1; 20261103' THEN RAISE EXCEPTION 'community_creation_attempts already exists; inspect before migration'; END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS public.community_joining_choices (
 community_id uuid PRIMARY KEY REFERENCES public.communities(id),
 method text NOT NULL CHECK(method IN ('open','approval_required')),
 chosen_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 chosen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public.community_joining_choices IS 'WashedUp explicit joining v1; 20261103';
ALTER TABLE public.community_joining_choices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.community_joining_choices FROM PUBLIC,anon,authenticated;

-- Private, account-bound receipts make a lost create response safe to check or retry.
CREATE TABLE IF NOT EXISTS public.community_creation_attempts (
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 payload jsonb NOT NULL,
 community_id uuid REFERENCES public.communities(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,request_id)
);
COMMENT ON TABLE public.community_creation_attempts IS 'WashedUp explicit joining v1; 20261103';
ALTER TABLE public.community_creation_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.community_creation_attempts FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.community_joining_is_open(p_community_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT c.join_policy='open' AND (
   EXISTS(SELECT 1 FROM public.creator_page_publications p WHERE p.page_id=c.id AND p.page_kind='community')
   OR EXISTS(SELECT 1 FROM public.community_joining_choices j WHERE j.community_id=c.id AND j.method='open')
 ) FROM public.communities c WHERE c.id=p_community_id),false);
$$;
REVOKE ALL ON FUNCTION public.community_joining_is_open(uuid) FROM PUBLIC,anon,authenticated;

-- A null ID probes availability during creation; a real ID reads the effective
-- admission method. Never advertise an old raw Open value as instant admission.
CREATE OR REPLACE FUNCTION public.get_community_joining_options(p_community_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE='42501'; END IF;
 IF p_community_id IS NULL THEN RETURN jsonb_build_object('version',1,'community_id',null,'method',null); END IF;
 IF NOT public.creator_community_is_visible(p_community_id)
 OR NOT EXISTS(SELECT 1 FROM public.communities WHERE id=p_community_id) THEN
  RAISE EXCEPTION 'Community unavailable' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('version',1,'community_id',p_community_id,
  'method',CASE WHEN public.community_joining_is_open(p_community_id) THEN 'open' ELSE 'approval_required' END);
END;
$$;
REVOKE ALL ON FUNCTION public.get_community_joining_options(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_community_joining_options(uuid) TO authenticated;

-- Keep the original grant-gated creator, blocks and leader membership. The
-- entire creation and explicit joining choice commit together, or not at all.
CREATE OR REPLACE FUNCTION public.create_community_with_joining(
 p_request_id uuid,p_handle text,p_name text,p_city text,p_purpose text,p_join_policy text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); v_payload jsonb; v_attempt public.community_creation_attempts; v_id uuid;
BEGIN
 IF v_uid IS NULL OR NOT public.has_operator_grant(v_uid,'community_leader') THEN
  RAISE EXCEPTION 'Community creator access required' USING ERRCODE='42501';
 END IF;
 IF p_request_id IS NULL OR p_join_policy IS NULL OR p_join_policy NOT IN ('open','approval_required') THEN
  RAISE EXCEPTION 'Choose a joining method' USING ERRCODE='22023';
 END IF;
 IF p_handle IS NULL OR p_handle !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
 OR char_length(btrim(coalesce(p_name,''))) NOT BETWEEN 2 AND 60
 OR char_length(btrim(coalesce(p_city,''))) NOT BETWEEN 1 AND 60
 OR char_length(btrim(coalesce(p_purpose,''))) NOT BETWEEN 10 AND 140 THEN
  RAISE EXCEPTION 'Check your community details' USING ERRCODE='22023';
 END IF;
 v_payload:=jsonb_build_object('handle',p_handle,'name',btrim(p_name),'city',btrim(p_city),
  'purpose',btrim(p_purpose),'method',p_join_policy);
 INSERT INTO public.community_creation_attempts(user_id,request_id,payload)
 VALUES(v_uid,p_request_id,v_payload) ON CONFLICT(user_id,request_id) DO NOTHING;
 SELECT * INTO v_attempt FROM public.community_creation_attempts
 WHERE user_id=v_uid AND request_id=p_request_id FOR UPDATE;
 IF v_attempt.payload IS DISTINCT FROM v_payload THEN
  RAISE EXCEPTION 'This request already belongs to different community details' USING ERRCODE='22023';
 END IF;
 IF v_attempt.community_id IS NOT NULL THEN RETURN v_attempt.community_id; END IF;
 v_id:=public.create_community(p_handle,btrim(p_name),null,btrim(p_city),btrim(p_purpose),p_join_policy);
 PERFORM public.set_community_join_policy(v_id,p_join_policy);
 UPDATE public.community_creation_attempts SET community_id=v_id WHERE user_id=v_uid AND request_id=p_request_id;
 RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_community_with_joining(uuid,text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_community_with_joining(uuid,text,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_community_creation_attempt(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('request_id',request_id,'community_id',community_id,'payload',payload)
 INTO result FROM public.community_creation_attempts WHERE user_id=auth.uid() AND request_id=p_request_id;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_community_creation_attempt(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_community_creation_attempt(uuid) TO authenticated;

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
  -- Legacy Open requires a recorded explicit creator choice; existing pending requests stay pending.
  if public.community_joining_is_open(p_community_id) then
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
  v_was_open boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if p_join_policy is null or p_join_policy not in ('approval_required', 'open') then
    raise exception 'Unknown join policy %', coalesce(p_join_policy, '(none)');
  end if;
  perform 1 from public.communities where id=p_community_id for update;
  if not found then raise exception 'Community unavailable' using errcode='42501'; end if;
  select (
      is_community_leader(p_community_id, v_uid)
      or is_admin(v_uid)
      or has_role(v_uid, 'admin'::app_role)
    )
    into v_ok;
  if v_ok is distinct from true then
    raise exception 'Not the leader of this community';
  end if;
  v_was_open := public.community_joining_is_open(p_community_id);
  update public.communities set join_policy = p_join_policy,
    creator_page_join_settings_version = creator_page_join_settings_version +
      case when v_was_open is distinct from (p_join_policy = 'open') then 1 else 0 end
    where id = p_community_id;
  insert into public.community_joining_choices(community_id,method,chosen_by,chosen_at)
  values(p_community_id,p_join_policy,v_uid,clock_timestamp())
  on conflict(community_id) do update set method=excluded.method,chosen_by=excluded.chosen_by,chosen_at=excluded.chosen_at;
end;
$function$
;
COMMIT;
