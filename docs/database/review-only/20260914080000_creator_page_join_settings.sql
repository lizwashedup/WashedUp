-- LOCAL / REVIEW ONLY: reuse community joining fields with exact page ownership.
-- Admission, member answers, requests, rooms and approval services are unchanged.
BEGIN;
ALTER TABLE public.communities ADD COLUMN creator_page_join_settings_version integer NOT NULL DEFAULT 0
 CHECK(creator_page_join_settings_version>=0);
-- This recovered schema grants SELECT per column. Preserve existing SELECT * readers.
GRANT SELECT(creator_page_join_settings_version) ON public.communities TO anon,authenticated;
CREATE FUNCTION public.creator_page_join_settings_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 NEW.creator_page_join_settings_version := OLD.creator_page_join_settings_version + CASE WHEN
 ROW(NEW.join_policy,NEW.join_welcome_message,NEW.join_intro_question,NEW.guidelines_url,
 NEW.join_ask_reason,NEW.join_ask_source,NEW.join_ask_rules_confirm,NEW.join_open_question)
 IS DISTINCT FROM ROW(OLD.join_policy,OLD.join_welcome_message,OLD.join_intro_question,OLD.guidelines_url,
 OLD.join_ask_reason,OLD.join_ask_source,OLD.join_ask_rules_confirm,OLD.join_open_question)
 OR NEW.creator_page_join_settings_version<>OLD.creator_page_join_settings_version THEN 1 ELSE 0 END;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.creator_page_join_settings_revision() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER creator_page_join_settings_revision BEFORE UPDATE OF join_policy,join_welcome_message,join_intro_question,guidelines_url,
 join_ask_reason,join_ask_source,join_ask_rules_confirm,join_open_question,creator_page_join_settings_version
 ON public.communities FOR EACH ROW EXECUTE FUNCTION public.creator_page_join_settings_revision();

CREATE FUNCTION public.get_creator_page_join_settings(p_page_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.creator_page_drafts; c public.communities; v_audience text; v_published boolean; v_name text;
BEGIN
 SELECT * INTO p FROM public.creator_page_drafts WHERE id=p_page_id;
 IF auth.uid() IS NULL OR p.id IS NULL OR p.owner_id<>auth.uid() OR p.page_kind<>'community'
 OR NOT public.creator_page_is_owned(p_page_id) THEN RAISE EXCEPTION 'Community page unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.communities WHERE id=p.id;
 IF c.id IS NOT NULL AND c.created_by IS DISTINCT FROM p.owner_id THEN RAISE EXCEPTION 'Community page identity conflict' USING ERRCODE='42501'; END IF;
 SELECT audience,true,name INTO v_audience,v_published,v_name FROM public.creator_page_publications WHERE page_id=p.id;
 RETURN jsonb_build_object('page_id',p.id,'owner_id',p.owner_id,'name',coalesce(v_name,p.page_data->>'name'),
 'published',coalesce(v_published,false),'audience',coalesce(v_audience,p.page_data->>'audience','everyone'),
 'version',coalesce(c.creator_page_join_settings_version,0),
 'pending_count',(SELECT count(*) FROM public.community_members WHERE community_id=p.id AND status='pending'),
 'settings',jsonb_build_object('join_policy',coalesce(c.join_policy,p.page_data->>'join_policy','open'),
 'join_welcome_message',c.join_welcome_message,'join_intro_question',c.join_intro_question,'guidelines_url',c.guidelines_url,
 'join_ask_reason',coalesce(c.join_ask_reason,false),'join_ask_source',coalesce(c.join_ask_source,false),
 'join_ask_rules_confirm',coalesce(c.join_ask_rules_confirm,false),'join_open_question',c.join_open_question));
END;
$$;
REVOKE ALL ON FUNCTION public.get_creator_page_join_settings(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_join_settings(uuid) TO authenticated;

CREATE FUNCTION public.save_creator_page_join_settings(p_page_id uuid,p_expected_version integer,p_settings jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_settings jsonb; normalized jsonb; key text; value text;
BEGIN
 -- Same page lock order as publication/event preparation. No account-wide grant.
 PERFORM 1 FROM public.creator_page_drafts WHERE id=p_page_id FOR UPDATE;
 current_settings:=public.get_creator_page_join_settings(p_page_id);
 IF p_expected_version IS NULL OR p_expected_version<0 OR p_settings IS NULL OR jsonb_typeof(p_settings)<>'object'
 OR (SELECT count(*) FROM jsonb_object_keys(p_settings))<>8
 OR NOT p_settings ?& ARRAY['join_policy','join_welcome_message','join_intro_question','guidelines_url',
 'join_ask_reason','join_ask_source','join_ask_rules_confirm','join_open_question'] THEN
 RAISE EXCEPTION 'Check the joining settings' USING ERRCODE='22023'; END IF;
 IF p_settings->>'join_policy' NOT IN ('open','approval_required') OR jsonb_typeof(p_settings->'join_policy')<>'string' THEN
 RAISE EXCEPTION 'Choose whether new members need approval' USING ERRCODE='22023'; END IF;
 FOREACH key IN ARRAY ARRAY['join_ask_reason','join_ask_source','join_ask_rules_confirm'] LOOP
 IF jsonb_typeof(p_settings->key)<>'boolean' THEN RAISE EXCEPTION 'Check the question choices' USING ERRCODE='22023'; END IF;
 END LOOP;
 normalized:=p_settings;
 FOREACH key IN ARRAY ARRAY['join_welcome_message','join_intro_question','guidelines_url','join_open_question'] LOOP
 IF jsonb_typeof(p_settings->key) NOT IN ('string','null') THEN RAISE EXCEPTION 'Check the question text' USING ERRCODE='22023'; END IF;
 value:=nullif(btrim(p_settings->>key),'');
 IF (key='join_welcome_message' AND length(value)>1000) OR (key IN ('join_intro_question','join_open_question') AND length(value)>200)
 OR (key='guidelines_url' AND value IS NOT NULL AND value!~*'^https?://[^[:space:]]+$') THEN
 RAISE EXCEPTION 'Check the question text or guidelines link' USING ERRCODE='22023'; END IF;
 normalized:=jsonb_set(normalized,ARRAY[key],coalesce(to_jsonb(value),'null'::jsonb));
 END LOOP;
 IF (normalized->>'join_ask_rules_confirm')::boolean AND current_settings->>'audience'='everyone' THEN
 RAISE EXCEPTION 'Membership confirmation requires a restricted community' USING ERRCODE='22023'; END IF;
 -- Ensure the existing community row only on an explicit save, never on a read.
 PERFORM public.ensure_creator_page_community(p_page_id);
 PERFORM 1 FROM public.communities WHERE id=p_page_id FOR UPDATE;
 current_settings:=public.get_creator_page_join_settings(p_page_id);
 -- A current identical configuration is confirmed even after a lost response.
 -- This confirms current state, not a historical receipt or replay of old intent.
 IF current_settings->'settings'=normalized AND (current_settings->>'version')::integer>0 THEN RETURN current_settings; END IF;
 IF (current_settings->>'version')::integer<>p_expected_version THEN
 RAISE EXCEPTION 'Joining settings changed. Check the saved version before saving again.' USING ERRCODE='PT409'; END IF;
 UPDATE public.communities SET join_policy=normalized->>'join_policy',join_welcome_message=normalized->>'join_welcome_message',
 join_intro_question=normalized->>'join_intro_question',guidelines_url=normalized->>'guidelines_url',
 join_ask_reason=(normalized->>'join_ask_reason')::boolean,join_ask_source=(normalized->>'join_ask_source')::boolean,
 join_ask_rules_confirm=(normalized->>'join_ask_rules_confirm')::boolean,join_open_question=normalized->>'join_open_question',
 creator_page_join_settings_version=creator_page_join_settings_version+1 WHERE id=p_page_id;
 RETURN public.get_creator_page_join_settings(p_page_id);
END;
$$;
REVOKE ALL ON FUNCTION public.save_creator_page_join_settings(uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_creator_page_join_settings(uuid,integer,jsonb) TO authenticated;

-- Preserve independently saved joining policy through publication. Fail closed if
-- the installed publication definition differs from the inspected local contract.
DO $$
DECLARE definition text; original text := $needle$join_policy=coalesce(s.page_snapshot->>'join_policy','open')$needle$;
BEGIN
 SELECT pg_get_functiondef('public.publish_creator_page(uuid,uuid)'::regprocedure) INTO definition;
 IF (length(definition)-length(replace(definition,original,'')))<>length(original) THEN
 RAISE EXCEPTION 'Publication definition changed; reconcile the joining-policy patch first'; END IF;
 EXECUTE replace(definition,original,$replacement$join_policy=CASE WHEN creator_page_join_settings_version>0 THEN join_policy ELSE coalesce(s.page_snapshot->>'join_policy','open') END$replacement$);
END;
$$;
COMMIT;
