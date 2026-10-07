-- LOCAL / REVIEW ONLY. Owner-only templates retain their exact source page.
-- Existing ordinary templates remain owner-only. No event/media/publication writes.
BEGIN;
ALTER TABLE public.operator_event_templates
 ADD COLUMN source_page_id uuid,
 ADD COLUMN source_event_id uuid,
 ADD COLUMN source_updated_at timestamptz,
 ADD CONSTRAINT operator_event_templates_source_complete CHECK (
  (source_page_id IS NULL AND source_event_id IS NULL AND source_updated_at IS NULL)
  OR (source_page_id IS NOT NULL AND source_event_id IS NOT NULL AND source_updated_at IS NOT NULL));

-- Do not delete or guess provenance for inherited private snapshots. They stay
-- stored but unavailable through ordinary template APIs until explicitly repaired.
CREATE FUNCTION public.creator_event_template_legacy_fields_allowed(p_fields jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(p_fields->>'image_url','') !~* 'creator-event-media|/private-'
 AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_fields->'description_blocks')='array' THEN p_fields->'description_blocks' ELSE '[]'::jsonb END) b
  WHERE coalesce(b->>'path','') ~* 'creator-event-media|/private-'
     OR coalesce(b->>'poster','') ~* 'creator-event-media|/private-');
$$;
CREATE FUNCTION public.creator_page_event_template_source_allowed(p_page_id uuid,p_event_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_page_id IS NOT NULL AND p_event_id IS NOT NULL
 AND coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false);
$$;
REVOKE ALL ON FUNCTION public.creator_event_template_legacy_fields_allowed(jsonb),public.creator_page_event_template_source_allowed(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_event_template_legacy_fields_allowed(jsonb),public.creator_page_event_template_source_allowed(uuid,uuid) TO authenticated;

-- Restrictive policies compose with the inherited user_id = auth.uid() rules.
-- Direct callers cannot forge, replace, or strip page provenance. Only the
-- saved-snapshot RPC below inserts a page template through its owner privileges.
CREATE POLICY operator_event_templates_source_select ON public.operator_event_templates AS RESTRICTIVE FOR SELECT TO authenticated USING (
 (source_page_id IS NULL AND public.creator_event_template_legacy_fields_allowed(fields))
 OR public.creator_page_event_template_source_allowed(source_page_id,source_event_id));
CREATE POLICY operator_event_templates_source_insert ON public.operator_event_templates AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (
 source_page_id IS NULL AND public.creator_event_template_legacy_fields_allowed(fields));
CREATE POLICY operator_event_templates_source_update ON public.operator_event_templates AS RESTRICTIVE FOR UPDATE TO authenticated USING (
 source_page_id IS NULL AND public.creator_event_template_legacy_fields_allowed(fields)) WITH CHECK (
 source_page_id IS NULL AND public.creator_event_template_legacy_fields_allowed(fields));

CREATE FUNCTION public.get_creator_page_event_template(p_page_id uuid,p_event_id uuid,p_template_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operator_event_templates;
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Source event unavailable' USING ERRCODE='42501'; END IF;
 IF p_template_id IS NULL THEN RAISE EXCEPTION 'Template unavailable' USING ERRCODE='22023'; END IF;
 SELECT * INTO t FROM public.operator_event_templates WHERE id=p_template_id;
 IF t.id IS NULL THEN RETURN NULL; END IF;
 IF t.user_id IS DISTINCT FROM auth.uid() OR t.source_page_id IS DISTINCT FROM p_page_id OR t.source_event_id IS DISTINCT FROM p_event_id THEN RAISE EXCEPTION 'Template unavailable' USING ERRCODE='42501'; END IF;
 RETURN to_jsonb(t);
END;
$$;

CREATE FUNCTION public.save_creator_page_event_template(p_page_id uuid,p_event_id uuid,p_template_id uuid,p_name text,p_expected_updated_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.explore_events; t public.operator_event_templates; snapshot jsonb; label text:=btrim(p_name);
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Source event unavailable' USING ERRCODE='42501'; END IF;
 IF p_template_id IS NULL OR p_expected_updated_at IS NULL OR label IS NULL OR char_length(label) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Check the template name and saved event' USING ERRCODE='22023'; END IF;
 -- Serialize same-ID retries, including requests that name different events.
 PERFORM pg_advisory_xact_lock(hashtextextended('creator-page-template:'||p_template_id::text,0));
 SELECT * INTO e FROM public.explore_events WHERE id=p_event_id FOR SHARE;
 IF e.id IS NULL OR NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Source event unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.operator_event_templates WHERE id=p_template_id;
 IF t.id IS NOT NULL THEN
  IF t.user_id IS DISTINCT FROM auth.uid() OR t.source_page_id IS DISTINCT FROM p_page_id OR t.source_event_id IS DISTINCT FROM p_event_id
   OR t.source_updated_at IS DISTINCT FROM p_expected_updated_at OR t.name IS DISTINCT FROM label THEN RAISE EXCEPTION 'Template attempt does not match' USING ERRCODE='22023'; END IF;
  RETURN to_jsonb(t);
 END IF;
 IF e.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'This event changed. Check its saved content.' USING ERRCODE='PT409'; END IF;
 snapshot:=public.get_creator_page_event_save_state(p_page_id,p_event_id)->'fields';
 INSERT INTO public.operator_event_templates(id,user_id,community_id,name,fields,source_page_id,source_event_id,source_updated_at)
 VALUES(p_template_id,auth.uid(),e.community_id,label,snapshot||jsonb_build_object('event_date','','start_time',NULL,'end_time',NULL),p_page_id,p_event_id,e.updated_at) RETURNING * INTO t;
 RETURN to_jsonb(t);
END;
$$;
-- Deleting one's template remains possible after source revocation, without
-- disclosing any retained private fields or granting access to the source page.
CREATE FUNCTION public.delete_creator_page_event_template(p_template_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR p_template_id IS NULL THEN RAISE EXCEPTION 'Template unavailable' USING ERRCODE='42501'; END IF;
 DELETE FROM public.operator_event_templates WHERE id=p_template_id AND user_id=auth.uid() AND source_page_id IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Template unavailable' USING ERRCODE='42501'; END IF;
 RETURN p_template_id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_creator_page_event_template(uuid,uuid,uuid),public.save_creator_page_event_template(uuid,uuid,uuid,text,timestamptz),public.delete_creator_page_event_template(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_event_template(uuid,uuid,uuid),public.save_creator_page_event_template(uuid,uuid,uuid,text,timestamptz),public.delete_creator_page_event_template(uuid) TO authenticated;
COMMIT;
