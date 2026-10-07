-- LOCAL / REVIEW ONLY. Existing question rows and answer references retained.
BEGIN;
CREATE TABLE public.creator_page_question_attempts (
 request_id uuid PRIMARY KEY, page_id uuid NOT NULL, event_id uuid NOT NULL, user_id uuid NOT NULL,
 request_hash text NOT NULL, receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.creator_page_question_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_page_question_attempts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_creator_page_question_attempt(p_page_id uuid,p_event_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.creator_page_question_attempts;
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false)
 OR NOT coalesce(public.is_ticketing_organizer(p_event_id,auth.uid()),false) THEN RAISE EXCEPTION 'Question access unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.creator_page_question_attempts WHERE request_id=p_request_id;
 IF a.request_id IS NULL THEN RETURN NULL; END IF;
 IF a.page_id<>p_page_id OR a.event_id<>p_event_id OR a.user_id<>auth.uid() THEN RAISE EXCEPTION 'Question action unavailable' USING ERRCODE='42501'; END IF;
 RETURN a.receipt;
END;
$$;

CREATE FUNCTION public.apply_creator_page_question_action(p_page_id uuid,p_event_id uuid,p_request_id uuid,p_kind text,p_expected jsonb,p_order uuid[],p_question_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.creator_page_question_attempts; actual jsonb; ids uuid[]; requested text; result jsonb;
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false)
 OR NOT coalesce(public.is_ticketing_organizer(p_event_id,auth.uid()),false) THEN RAISE EXCEPTION 'Question access unavailable' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_kind IS NULL OR p_kind NOT IN('reorder','retire') OR jsonb_typeof(p_expected) IS DISTINCT FROM 'array'
 OR (p_kind='reorder' AND (p_order IS NULL OR p_question_id IS NOT NULL))
 OR (p_kind='retire' AND (p_question_id IS NULL OR p_order IS NOT NULL)) THEN RAISE EXCEPTION 'Check the question action' USING ERRCODE='22023'; END IF;
 requested:=encode(sha256(convert_to(jsonb_build_object('kind',p_kind,'expected',p_expected,'order',p_order,'question_id',p_question_id)::text,'UTF8')),'hex');
 -- Parent lock also serializes new rows through the event foreign key.
 PERFORM 1 FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 PERFORM 1 FROM public.ticket_questions WHERE event_id=p_event_id ORDER BY id FOR UPDATE;
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false)
 OR NOT coalesce(public.is_ticketing_organizer(p_event_id,auth.uid()),false) THEN RAISE EXCEPTION 'Question access unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.creator_page_question_attempts WHERE request_id=p_request_id;
 IF a.request_id IS NOT NULL THEN
  IF a.page_id<>p_page_id OR a.event_id<>p_event_id OR a.user_id<>auth.uid() OR a.request_hash<>requested THEN RAISE EXCEPTION 'Question action does not match' USING ERRCODE='22023'; END IF;
  RETURN a.receipt;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.sort_order,q.id),'[]'::jsonb),coalesce(array_agg(q.id ORDER BY q.sort_order,q.id),'{}'::uuid[])
 INTO actual,ids FROM (SELECT id,event_id,prompt,qtype,options,required,scope,sort_order,is_active FROM public.ticket_questions WHERE event_id=p_event_id AND is_active) q;
 IF actual IS NOT DISTINCT FROM p_expected THEN
 IF p_kind='reorder' THEN
  IF cardinality(p_order)<>cardinality(ids) OR array_position(p_order,NULL) IS NOT NULL
  OR (SELECT count(DISTINCT x) FROM unnest(p_order) x)<>cardinality(ids)
  OR NOT p_order @> ids THEN RAISE EXCEPTION 'Order must contain every active question exactly once' USING ERRCODE='22023'; END IF;
  UPDATE public.ticket_questions q SET sort_order=(o.ordinality-1)::integer,updated_at=now()
   FROM unnest(p_order) WITH ORDINALITY o(id,ordinality) WHERE q.event_id=p_event_id AND q.id=o.id AND q.is_active;
 ELSE
  IF NOT p_question_id=ANY(ids) THEN RAISE EXCEPTION 'Question is unavailable' USING ERRCODE='PT409'; END IF;
  UPDATE public.ticket_questions SET is_active=false,updated_at=now() WHERE event_id=p_event_id AND id=p_question_id;
 END IF;
 END IF;
 result:=jsonb_build_object('outcome',CASE WHEN actual IS DISTINCT FROM p_expected THEN 'changed' ELSE 'confirmed' END,'request_id',p_request_id,'page_id',p_page_id,'event_id',p_event_id,'user_id',auth.uid(),'kind',p_kind,'question_id',p_question_id,
  'active_ids',CASE WHEN actual IS DISTINCT FROM p_expected THEN ids WHEN p_kind='reorder' THEN p_order ELSE array_remove(ids,p_question_id) END);
 INSERT INTO public.creator_page_question_attempts(request_id,page_id,event_id,user_id,request_hash,receipt) VALUES(p_request_id,p_page_id,p_event_id,auth.uid(),requested,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_creator_page_question_attempt(uuid,uuid,uuid),public.apply_creator_page_question_action(uuid,uuid,uuid,text,jsonb,uuid[],uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_question_attempt(uuid,uuid,uuid),public.apply_creator_page_question_action(uuid,uuid,uuid,text,jsonb,uuid[],uuid) TO authenticated;
COMMIT;
