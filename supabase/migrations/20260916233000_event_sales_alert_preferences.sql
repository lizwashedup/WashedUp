-- Optional creator sale alerts are personal; buyer confirmations stay independent.
-- Settings only: no queue, provider call or delivery activation.
BEGIN;
CREATE TABLE public.event_sales_alert_preferences (
 event_id uuid NOT NULL REFERENCES public.explore_events(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 revision uuid NOT NULL DEFAULT gen_random_uuid(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(event_id,user_id)
);
ALTER TABLE public.event_sales_alert_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_sales_alert_preferences FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.get_event_sales_alert_preference(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.event_sales_alert_preferences;
BEGIN
 IF NOT coalesce(public.attendee_message_is_event_organizer(p_event_id,auth.uid()),false) THEN
  RAISE EXCEPTION 'Sale alert access denied' USING ERRCODE='42501';
 END IF;
 SELECT * INTO s FROM public.event_sales_alert_preferences WHERE event_id=p_event_id AND user_id=auth.uid();
 RETURN jsonb_build_object('eventId',p_event_id,'userId',auth.uid(),'enabled',coalesce(s.enabled,false),
  'revision',s.revision,'updatedAt',s.updated_at,'deliveryReady',false);
END$$;
CREATE FUNCTION public.save_event_sales_alert_preference(p_event_id uuid,p_revision uuid,p_enabled boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved jsonb;
BEGIN
 PERFORM public.get_event_sales_alert_preference(p_event_id);
 PERFORM 1 FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 saved:=public.get_event_sales_alert_preference(p_event_id);
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Choose a sale alert preference'; END IF;
 IF saved->>'revision' IS NOT NULL AND (saved->>'enabled')::boolean=p_enabled THEN RETURN saved; END IF;
 IF p_revision IS DISTINCT FROM (saved->>'revision')::uuid THEN
  RAISE EXCEPTION 'Sale alert preference changed. Check its saved status.' USING ERRCODE='P0001';
 END IF;
 INSERT INTO public.event_sales_alert_preferences(event_id,user_id,enabled)
 VALUES(p_event_id,auth.uid(),p_enabled)
 ON CONFLICT(event_id,user_id) DO UPDATE SET enabled=excluded.enabled,revision=gen_random_uuid(),updated_at=now();
 RETURN public.get_event_sales_alert_preference(p_event_id);
END$$;
REVOKE ALL ON FUNCTION public.get_event_sales_alert_preference(uuid),public.save_event_sales_alert_preference(uuid,uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_event_sales_alert_preference(uuid),public.save_event_sales_alert_preference(uuid,uuid,boolean) TO authenticated;
COMMENT ON TABLE public.event_sales_alert_preferences IS 'Personal exact-event creator sale email preference. Default off, delivery not enabled. Never controls buyer confirmations.';
COMMIT;
