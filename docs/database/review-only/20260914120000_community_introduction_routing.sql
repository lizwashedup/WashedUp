-- REVIEW ONLY: standard introduction once and source-preserving room routing.
-- Local creator-page rollout after 110/111; legacy admission remains unchanged.
-- No history copy, message rewrite, room backfill, or provider notification change.
BEGIN;
DO $$ BEGIN
 IF md5(pg_get_functiondef('public.finalize_community_join(uuid,uuid,boolean)'::regprocedure))<>'24c3dd440e6c98c86358710ca883a96c' THEN RAISE EXCEPTION 'Unexpected admission finalizer; inspect before replacing'; END IF;
END $$;

CREATE TABLE public.community_introduction_receipts (
 community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 source_kind text NOT NULL CHECK(source_kind IN ('broadcast','prior_admission')),
 source_id uuid,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(community_id,user_id),
 CHECK((source_kind='broadcast' AND source_id IS NOT NULL) OR (source_kind='prior_admission' AND source_id IS NULL))
);
-- A receipt survives departure, membership-row cleanup and message deletion.
-- No raw answers, contact information, or new public member history is stored.
ALTER TABLE public.community_introduction_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_introduction_receipts FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.community_introduction_receipts(community_id,user_id,source_kind,source_id)
 SELECT DISTINCT ON(b.community_id,b.sender_id) b.community_id,b.sender_id,'broadcast',b.id
 FROM public.community_broadcasts b JOIN public.creator_page_publications p ON p.page_id=b.community_id AND p.page_kind='community'
 WHERE b.kind='intro' AND b.sender_id IS NOT NULL ORDER BY b.community_id,b.sender_id,b.created_at,b.id;
-- Historical admission is not proof of an extant intro. Suppress automatic
-- reposting without claiming delivery or turning old private answers public.
INSERT INTO public.community_introduction_receipts(community_id,user_id,source_kind)
 SELECT m.community_id,m.user_id,'prior_admission' FROM public.community_members m
 JOIN public.creator_page_publications p ON p.page_id=m.community_id AND p.page_kind='community'
 WHERE m.status IN ('active','left') OR m.joined_at IS NOT NULL
 ON CONFLICT(community_id,user_id) DO NOTHING;

CREATE FUNCTION public.preserve_community_prior_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (OLD.status IN ('active','left') OR OLD.joined_at IS NOT NULL) AND EXISTS(
 SELECT 1 FROM public.creator_page_publications WHERE page_id=OLD.community_id AND page_kind='community')
 AND EXISTS(SELECT 1 FROM public.communities WHERE id=OLD.community_id) AND EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.user_id) THEN
  INSERT INTO public.community_introduction_receipts(community_id,user_id,source_kind) VALUES(OLD.community_id,OLD.user_id,'prior_admission')
  ON CONFLICT(community_id,user_id) DO NOTHING;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.preserve_community_prior_admission() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER preserve_community_prior_admission BEFORE UPDATE OF status,joined_at OR DELETE ON public.community_members
 FOR EACH ROW EXECUTE FUNCTION public.preserve_community_prior_admission();
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

-- Read original row references under the caller's existing RLS. Consumers fetch
-- bodies/replies/reactions from their original sources and retain source-qualified
-- IDs. Main and Intros use disjoint broadcast predicates; historical topic rows
-- are never merged into main or moved out of their original topic.
CREATE FUNCTION public.get_community_room_message_refs(
 p_community_id uuid,p_role text,p_limit integer DEFAULT 50,
 p_before_created_at timestamptz DEFAULT NULL,p_before_source text DEFAULT NULL,p_before_id uuid DEFAULT NULL
) RETURNS TABLE(source text,id uuid,created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_intro uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_community_member(p_community_id,auth.uid()) THEN RAISE EXCEPTION 'Community chat unavailable' USING ERRCODE='42501'; END IF;
 IF p_role IS NULL OR p_role NOT IN ('intros','main') OR p_limit IS NULL OR p_limit<1 OR p_limit>100
 OR num_nonnulls(p_before_created_at,p_before_source,p_before_id) NOT IN (0,3)
 OR (p_before_source IS NOT NULL AND p_before_source NOT IN ('broadcast','topic')) THEN RAISE EXCEPTION 'Invalid room history request' USING ERRCODE='22023'; END IF;
 SELECT l.intro_topic_id INTO v_intro FROM public.community_chat_layouts l WHERE l.community_id=p_community_id;
 IF v_intro IS NULL OR NOT EXISTS(SELECT 1 FROM public.communities WHERE communities.id=p_community_id)
 OR NOT EXISTS(SELECT 1 FROM public.community_topics t WHERE t.id=v_intro AND NOT t.archived AND t.original_event_id IS NULL) THEN
 RAISE EXCEPTION 'Community chats are not ready' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT refs.source,refs.id,refs.created_at FROM (
  SELECT 'broadcast'::text source,b.id,b.created_at FROM public.community_broadcasts b WHERE b.community_id=p_community_id
   AND ((p_role='intros' AND b.kind='intro') OR (p_role='main' AND b.kind<>'intro'))
  UNION ALL
  SELECT 'topic'::text,t.id,t.created_at FROM public.community_topic_messages t WHERE p_role='intros' AND t.topic_id=v_intro
 ) refs WHERE p_before_created_at IS NULL OR (refs.created_at,refs.source,refs.id)<(p_before_created_at,p_before_source,p_before_id)
 ORDER BY refs.created_at DESC,refs.source DESC,refs.id DESC LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.get_community_room_message_refs(uuid,text,integer,timestamptz,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_community_room_message_refs(uuid,text,integer,timestamptz,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
