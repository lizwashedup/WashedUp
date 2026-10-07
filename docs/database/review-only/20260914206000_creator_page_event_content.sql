-- LOCAL / REVIEW ONLY. Selected Page events includes its existing body media.
-- Preserve financial authorization, original Storage paths and existing policies.
BEGIN;
CREATE FUNCTION public.creator_page_event_content_can_write(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event uuid;
BEGIN
 IF p_name IS NULL OR p_name !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[^/]+$' THEN RETURN false; END IF;
 v_event:=split_part(p_name,'/',1)::uuid;
 RETURN coalesce(public.creator_page_team_event_can_manage(v_event) AND public.creator_event_owner_is_eligible(v_event),false);
END;
$$;
REVOKE ALL ON FUNCTION public.creator_page_event_content_can_write(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_page_event_content_can_write(text) TO authenticated;
CREATE POLICY creator_page_event_content_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='event-content' AND public.creator_page_event_content_can_write(name));
CREATE POLICY creator_page_event_content_update ON storage.objects FOR UPDATE TO authenticated
 USING(bucket_id='event-content' AND public.creator_page_event_content_can_write(name))
 WITH CHECK(bucket_id='event-content' AND public.creator_page_event_content_can_write(name));
CREATE POLICY creator_page_event_content_delete ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='event-content' AND public.creator_page_event_content_can_write(name));
COMMIT;
