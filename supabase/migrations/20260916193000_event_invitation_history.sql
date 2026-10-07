-- Exact-page creator history. The private recipient ledger stays inaccessible.
BEGIN;
CREATE FUNCTION public.get_event_invitation_history(
 p_event_id uuid,p_page_id uuid,p_before_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=public.event_invitation_context(p_event_id);
 IF p_page_id IS NULL OR (context->>'pageId')::uuid<>p_page_id THEN
  RAISE EXCEPTION 'Invitation history access denied' USING ERRCODE='42501';
 END IF;
 IF (p_before_at IS NULL)<>(p_before_id IS NULL) OR (p_before_at IS NOT NULL AND NOT isfinite(p_before_at)) THEN
  RAISE EXCEPTION 'Invalid invitation history cursor';
 END IF;
 WITH selected AS (
  SELECT i.id,i.event_id,i.audience,i.body,i.recipient_count,i.created_at
  FROM public.event_invitation_sends i
  WHERE i.event_id=p_event_id AND i.page_id=p_page_id
  AND (p_before_at IS NULL OR (i.created_at,i.id)<(p_before_at,p_before_id))
  ORDER BY i.created_at DESC,i.id DESC LIMIT 21
 ), shown AS (SELECT * FROM selected ORDER BY created_at DESC,id DESC LIMIT 20)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC,s.id DESC) FROM shown s),'[]'::jsonb),
  'next',CASE WHEN (SELECT count(*) FROM selected)>20 THEN
    (SELECT jsonb_build_object('id',s.id,'created_at',s.created_at) FROM shown s ORDER BY s.created_at,s.id LIMIT 1)
   ELSE NULL END) INTO result;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.get_event_invitation_history(uuid,uuid,timestamptz,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_event_invitation_history(uuid,uuid,timestamptz,uuid) TO authenticated;
COMMENT ON FUNCTION public.get_event_invitation_history(uuid,uuid,timestamptz,uuid) IS 'Current exact-page/event invitation authority; saved content and aggregate queued count only. Deleted-event original request recovery stays with the sender receipt API.';
COMMIT;
