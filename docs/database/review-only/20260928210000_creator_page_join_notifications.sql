-- REVIEW ONLY. Apply after the existing creator page publication/team/membership request chain.
-- Exact joining notification source IDs, current recipient eligibility and durable deleted-source tombstones.
-- Coordinate matching client + push worker. No provider configuration or queue drain.
-- review94 already received this exact product DDL via the guarded local packet; do not reapply there.
BEGIN;
DO $prerequisites$ BEGIN
 IF to_regclass('public.creator_page_publications') IS NULL OR to_regclass('public.creator_page_team_assignments') IS NULL OR to_regclass('public.creator_page_team_invitations') IS NULL OR to_regclass('public.creator_community_join_requests') IS NULL THEN RAISE EXCEPTION 'Creator page publication/team/request prerequisite missing'; END IF;
 IF to_regclass('public.creator_page_join_notifications') IS NOT NULL THEN RAISE EXCEPTION 'Joining notification schema already installed; inspect state before retry'; END IF;
 IF to_regprocedure('public.review_community_join(uuid,boolean)') IS NULL OR md5(pg_get_functiondef('public.review_community_join(uuid,boolean)'::regprocedure))<>'a8fa85fa81660e7e0ca1bcbf556b0dd9' THEN RAISE EXCEPTION 'Joining prerequisite function drift: review_community_join(uuid,boolean)'; END IF;
 IF to_regprocedure('public.request_to_join_community(uuid,jsonb)') IS NULL OR md5(pg_get_functiondef('public.request_to_join_community(uuid,jsonb)'::regprocedure))<>'25a8d44bfcbbce375d24d23c4cf75f36' THEN RAISE EXCEPTION 'Joining prerequisite function drift: request_to_join_community(uuid,jsonb)'; END IF;
 IF to_regprocedure('public.finalize_community_join(uuid,uuid,boolean)') IS NULL OR md5(pg_get_functiondef('public.finalize_community_join(uuid,uuid,boolean)'::regprocedure))<>'867a8fadc9854e2fdb3ddc31042b4f53' THEN RAISE EXCEPTION 'Joining prerequisite function drift: finalize_community_join(uuid,uuid,boolean)'; END IF;
 IF to_regprocedure('public.review_creator_page_join_request(uuid,uuid,boolean,timestamp with time zone)') IS NULL OR md5(pg_get_functiondef('public.review_creator_page_join_request(uuid,uuid,boolean,timestamp with time zone)'::regprocedure))<>'81306d9c6c65eb8512e9e5600b0b47b1' THEN RAISE EXCEPTION 'Joining prerequisite function drift: review_creator_page_join_request(uuid,uuid,boolean,timestamp with time zone)'; END IF;
 IF to_regprocedure('public.creator_join_notice_reviewer(uuid,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Joining additive function already exists: creator_join_notice_reviewer(uuid,uuid)'; END IF;
 IF to_regprocedure('public.creator_join_notice_eligible(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Joining additive function already exists: creator_join_notice_eligible(uuid)'; END IF;
 IF to_regprocedure('public.emit_creator_join_notice(uuid,text,uuid,text,text)') IS NOT NULL THEN RAISE EXCEPTION 'Joining additive function already exists: emit_creator_join_notice(uuid,text,uuid,text,text)'; END IF;
 IF to_regprocedure('public.get_my_creator_page_join_notice(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Joining additive function already exists: get_my_creator_page_join_notice(uuid)'; END IF;
 IF to_regprocedure('public.get_creator_page_join_push_targets(uuid[])') IS NOT NULL THEN RAISE EXCEPTION 'Joining additive function already exists: get_creator_page_join_push_targets(uuid[])'; END IF;
END $prerequisites$;

-- Candidate only. Applied inside the owned regression clone first.
-- Source IDs remain as tombstones if a source parent disappears; never downgrade mapped notices to legacy.
CREATE TABLE public.creator_page_join_notifications (
 notification_id uuid PRIMARY KEY REFERENCES public.app_notifications(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 page_id uuid NOT NULL,
 member_id uuid NOT NULL,
 user_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('request','approved','declined')),
 member_updated_at timestamptz NOT NULL,
 UNIQUE(page_id,member_id,user_id,kind,member_updated_at)
);
ALTER TABLE public.creator_page_join_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_notice ON public.creator_page_join_notifications FOR SELECT TO authenticated USING(user_id=auth.uid());
REVOKE ALL ON public.creator_page_join_notifications FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.creator_page_join_notifications TO authenticated,service_role;

CREATE FUNCTION public.creator_join_notice_reviewer(p_page uuid,p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.creator_page_publications p
 WHERE p.page_id=p_page AND p.page_kind='community'
 AND public.creator_page_team_eligible(p.page_id,p.owner_id,p_user)
 AND (p.owner_id=p_user OR EXISTS(SELECT 1 FROM public.creator_page_team_assignments a
 JOIN public.creator_page_team_invitations i ON i.id=a.invitation_id
 WHERE a.page_id=p.page_id AND a.user_id=p_user AND i.page_id=a.page_id AND i.recipient_id=a.user_id
 AND i.inviter_id=p.owner_id AND i.status='accepted' AND a.revoked_at IS NULL AND 'membership_requests'=ANY(a.permissions))));
$fn$;
REVOKE ALL ON FUNCTION public.creator_join_notice_reviewer(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.creator_join_notice_eligible(p_notification uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.creator_page_join_notifications s
 JOIN public.app_notifications n ON n.id=s.notification_id AND n.user_id=s.user_id
 JOIN public.creator_page_publications p ON p.page_id=s.page_id AND p.page_kind='community'
 JOIN public.community_members m ON m.id=s.member_id AND m.community_id=s.page_id
 WHERE s.notification_id=p_notification
 AND n.type='community_join_'||s.kind AND m.updated_at=s.member_updated_at
 AND public.creator_page_team_eligible(p.page_id,p.owner_id,s.user_id)
 AND NOT public.yours_is_blocked_between(s.user_id,m.user_id)
 AND CASE s.kind WHEN 'request' THEN m.status='pending' AND s.user_id<>m.user_id AND public.creator_join_notice_reviewer(s.page_id,s.user_id)
 WHEN 'approved' THEN m.status='active' AND s.user_id=m.user_id
 WHEN 'declined' THEN m.status='declined' AND s.user_id=m.user_id ELSE false END);
$fn$;
REVOKE ALL ON FUNCTION public.creator_join_notice_eligible(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.emit_creator_join_notice(p_member uuid,p_kind text,p_actor uuid,p_title text,p_body text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE m public.community_members; p public.creator_page_publications; recipient uuid; notice uuid;
BEGIN
 SELECT * INTO m FROM public.community_members WHERE id=p_member;
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=m.community_id AND page_kind='community';
 IF p.page_id IS NULL OR p_kind NOT IN('request','approved','declined') OR
 m.status::text<>(CASE p_kind WHEN 'request' THEN 'pending' WHEN 'approved' THEN 'active' ELSE 'declined' END) THEN RAISE EXCEPTION 'Invalid page join notice'; END IF;
 FOR recipient IN
  SELECT DISTINCT candidate FROM (
   SELECT p.owner_id candidate WHERE p_kind='request'
   UNION ALL SELECT a.user_id FROM public.creator_page_team_assignments a WHERE a.page_id=p.page_id AND p_kind='request'
   UNION ALL SELECT m.user_id WHERE p_kind IN('approved','declined')
  ) candidates WHERE
   (p_kind<>'request' OR (candidate<>p_actor AND candidate<>m.user_id AND public.creator_join_notice_reviewer(p.page_id,candidate)))
   AND public.creator_page_team_eligible(p.page_id,p.owner_id,candidate)
   AND NOT public.yours_is_blocked_between(candidate,m.user_id)
 LOOP
  notice:=gen_random_uuid();
  INSERT INTO public.creator_page_join_notifications(notification_id,page_id,member_id,user_id,kind,member_updated_at)
  VALUES(notice,p.page_id,m.id,recipient,p_kind,m.updated_at) ON CONFLICT(page_id,member_id,user_id,kind,member_updated_at) DO NOTHING;
  IF FOUND THEN
   INSERT INTO public.app_notifications(id,user_id,type,title,body,actor_user_id)
   VALUES(notice,recipient,'community_join_'||p_kind,p_title,p_body,p_actor);
  END IF;
 END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.emit_creator_join_notice(uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_my_creator_page_join_notice(p_notification_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE s public.creator_page_join_notifications;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.app_notifications n WHERE n.id=p_notification_id AND n.user_id=auth.uid() AND n.type IN('community_join_request','community_join_approved','community_join_declined')) THEN RAISE EXCEPTION 'Notification unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.creator_page_join_notifications WHERE notification_id=p_notification_id AND user_id=auth.uid();
 IF s.notification_id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('notification_id',s.notification_id,'page_id',s.page_id,'member_id',s.member_id,'kind',s.kind,'eligible',public.creator_join_notice_eligible(s.notification_id));
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_my_creator_page_join_notice(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_creator_page_join_notice(uuid) TO authenticated;

CREATE FUNCTION public.get_creator_page_join_push_targets(p_notification_ids uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT coalesce(jsonb_agg(jsonb_build_object('notification_id',n.id,'user_id',n.user_id,
 'legacy',s.notification_id IS NULL,'page_id',s.page_id,'member_id',s.member_id,'kind',s.kind,
 'eligible',CASE WHEN s.notification_id IS NULL THEN true ELSE n.status='unread' AND NOT n.push_suppressed AND n.expires_at>now() AND public.creator_join_notice_eligible(n.id) END)),'[]'::jsonb)
 FROM public.app_notifications n LEFT JOIN public.creator_page_join_notifications s ON s.notification_id=n.id AND s.user_id=n.user_id
 WHERE n.id=ANY(p_notification_ids) AND n.type IN('community_join_request','community_join_approved','community_join_declined');
$fn$;
REVOKE ALL ON FUNCTION public.get_creator_page_join_push_targets(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_creator_page_join_push_targets(uuid[]) TO service_role;

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
  v_standard boolean := false;
  v_intro_id uuid;
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

  v_standard := EXISTS(SELECT 1 FROM public.creator_page_publications WHERE page_id=v_row.community_id AND page_kind='community');
  IF v_standard THEN PERFORM public.ensure_community_chat_layout(v_row.community_id); END IF;

  update community_members
  set status = 'active', joined_at = now()
  where id = v_row.id;

  -- the system-composed intro card, into the main chat (zip never leaves
  -- community_member_answers; only the area name travels)
  select a.answers into v_answers
  from community_member_answers a where a.member_id = v_row.id;

  v_first := btrim(coalesce(v_answers->>'first_name', ''));
  v_intro := btrim(coalesce(v_answers->>'intro_answer', ''));
  if v_standard then
    -- The community lock covers the receipt decision, admission and insertion.
    -- Publish only the standard member-written answer; never derive an area or
    -- append a custom question/answer/contact field. Compatibility placeholders
    -- keep older renderers valid while the versioned renderer uses plain text.
    if NOT EXISTS(SELECT 1 FROM public.community_introduction_receipts WHERE community_id=v_row.community_id AND user_id=v_row.user_id) then
      if v_first='' or v_intro='' OR char_length(v_intro)>1000 then
        raise exception 'A standard introduction is required before admission';
      end if;
      insert into public.community_broadcasts(community_id,sender_id,body,kind,payload)
      values(v_row.community_id,v_row.user_id,v_intro,'intro',jsonb_build_object(
        'format','member_intro_v1','user_id',v_row.user_id,'first_name',v_first,
        'area',null,'question','Introduce yourself','answer',v_intro)) returning id into v_intro_id;
      insert into public.community_introduction_receipts(community_id,user_id,source_kind,source_id)
      values(v_row.community_id,v_row.user_id,'broadcast',v_intro_id);
      v_posted:=true;
    end if;
  elsif v_first <> '' and v_intro <> '' then
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
  IF v_standard THEN
    PERFORM public.emit_creator_join_notice(v_row.id,'approved',p_actor_uid,'you''re in',case when p_self then 'you''re in at ' || v_community_name || case when v_posted then '. your introduction is already posted, come say hi.' else '. come say hi.' end else v_community_name || case when v_posted then ' let you in. your introduction is already posted, come say hi.' else ' let you in. come say hi.' end end);
  ELSE
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
  END IF;
end;
$function$;


CREATE OR REPLACE FUNCTION public.review_creator_page_join_request(p_page_id uuid, p_member_id uuid, p_approve boolean, p_expected_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE page public.creator_page_publications; member public.community_members;
BEGIN
 IF p_approve IS NULL OR p_member_id IS NULL OR p_expected_updated_at IS NULL THEN RAISE EXCEPTION 'Choose a request and decision' USING ERRCODE='22023'; END IF;
 -- Same first lock as owner permission editing/revocation, then existing admission order.
 SELECT * INTO page FROM public.creator_page_publications WHERE page_id=p_page_id AND page_kind='community' FOR UPDATE;
 IF page.page_id IS NULL OR NOT public.creator_page_team_can_manage(p_page_id,'membership_requests') THEN
  RAISE EXCEPTION 'Page requests unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.communities WHERE id=p_page_id FOR UPDATE;
 SELECT * INTO member FROM public.community_members WHERE id=p_member_id AND community_id=p_page_id FOR UPDATE;
 IF member.id IS NULL THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
 IF NOT public.creator_page_team_can_manage(p_page_id,'membership_requests') THEN RAISE EXCEPTION 'Page access changed' USING ERRCODE='42501'; END IF;
 IF member.status<>'pending' THEN
  -- A repeated same decision confirms current state; never repeats its effects.
  IF (p_approve AND member.status='active') OR (NOT p_approve AND member.status='declined') THEN
   RETURN jsonb_build_object('page_id',p_page_id,'member_id',member.id,'status',member.status,'changed',false);
  END IF;
  RAISE EXCEPTION 'This request was already handled. Check its status.' USING ERRCODE='P0001';
 END IF;
 IF member.updated_at IS DISTINCT FROM p_expected_updated_at THEN
  RAISE EXCEPTION 'This request changed. Review the current answers.' USING ERRCODE='PT409';
 END IF;
 IF p_approve THEN
  IF NOT public.creator_page_team_eligible(p_page_id,page.owner_id,member.user_id) THEN
   RAISE EXCEPTION 'This person is no longer eligible to join this page' USING ERRCODE='42501';
  END IF;
  PERFORM public.finalize_community_join(member.id,auth.uid(),false);
 ELSE
  UPDATE public.community_members SET status='declined' WHERE id=member.id;
  PERFORM public.emit_creator_join_notice(member.id,'declined',auth.uid(),'about your request',
   'not this time, and that''s okay. there are more communities to find.');
 END IF;
 RETURN jsonb_build_object('page_id',p_page_id,'member_id',member.id,'status',CASE WHEN p_approve THEN 'active' ELSE 'declined' END,'changed',true);
END;
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
    IF EXISTS(SELECT 1 FROM public.creator_page_publications WHERE page_id=v_row.community_id AND page_kind='community') THEN
      PERFORM public.emit_creator_join_notice(v_row.id,'declined',v_uid,'about your request','not this time, and that''s okay. there are more communities to find.');
    ELSE
    insert into app_notifications (user_id, type, title, body, actor_user_id)
    values (
      v_row.user_id,
      'community_join_declined',
      'about your request',
      'not this time, and that''s okay. there are more communities to find.',
      v_uid
    );
    END IF;
    return;
  end if;

  -- the activate + intro + you're-in tail, now shared with the open path
  perform finalize_community_join(v_row.id, v_uid, false);
end;
$function$;


COMMIT;
