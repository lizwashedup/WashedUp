-- LOCAL / REVIEW ONLY. Reuse the existing exact-page event capability and saved IDs.
-- Adds only existing artwork/date metadata; no new permission or owner-private fields.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_creator_page_team_workspace(p_page_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.creator_page_publications;
BEGIN
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=p_page_id;
 IF p.page_id IS NULL OR NOT public.creator_page_team_can_manage(p_page_id,'page_events') THEN
  RAISE EXCEPTION 'Page unavailable' USING ERRCODE='42501'; END IF;
 -- Explicit published-content projection; no draft applications, submissions,
 -- private review evidence, financial fields or unrelated-page records.
 RETURN jsonb_build_object('page_id',p.page_id,'page_kind',p.page_kind,'page_name',p.name,'owner_id',p.owner_id,
  'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'category',e.category,'status',e.status,'image_url',e.image_url,'event_date',e.event_date)
   ORDER BY e.created_at DESC,e.id),'[]'::jsonb) FROM public.creator_page_events l
   JOIN public.explore_events e ON e.id=l.event_id WHERE l.page_id=p_page_id));
END;
$$;
-- CREATE OR REPLACE preserves the existing execute grants.
COMMIT;
