-- LOCAL / REVIEW ONLY. Settle a lost removal response for a purchased extra.
-- The durable FK preserves the existing history rule even if an old DELETE arrives later.
BEGIN;
CREATE TABLE public.creator_extra_history_settlements (
 request_id uuid PRIMARY KEY,
 page_id uuid NOT NULL, event_id uuid NOT NULL, user_id uuid NOT NULL,
 extra_id uuid NOT NULL REFERENCES public.event_add_ons(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.creator_extra_history_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_extra_history_settlements FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.settle_creator_page_extra_removal(p_page_id uuid,p_event_id uuid,p_request_id uuid,p_extra_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved public.creator_extra_history_settlements; extra public.event_add_ons; outcome text;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false)
 OR NOT coalesce(public.is_ticketing_organizer(p_event_id,auth.uid()),false) THEN
  RAISE EXCEPTION 'Extra access unavailable' USING ERRCODE='42501';
 END IF;
 IF p_request_id IS NULL OR p_extra_id IS NULL THEN RAISE EXCEPTION 'Check the original extra action' USING ERRCODE='22023'; END IF;
 -- Same request serializes even if mistakenly reused for a different event/extra.
 PERFORM pg_advisory_xact_lock(hashtextextended('extra-history:'||p_request_id::text,0));
 SELECT * INTO saved FROM public.creator_extra_history_settlements WHERE request_id=p_request_id;
 IF saved.request_id IS NOT NULL THEN
  IF saved.page_id<>p_page_id OR saved.event_id<>p_event_id OR saved.user_id<>auth.uid() OR saved.extra_id<>p_extra_id THEN
   RAISE EXCEPTION 'Extra action does not match' USING ERRCODE='22023';
  END IF;
  outcome:='in_use';
 ELSE
  -- Serialize with checkout/DELETE; no purchase, counter or sale status is changed.
  SELECT * INTO extra FROM public.event_add_ons WHERE id=p_extra_id AND event_id=p_event_id FOR UPDATE;
  IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false)
  OR NOT coalesce(public.is_ticketing_organizer(p_event_id,auth.uid()),false) THEN
   RAISE EXCEPTION 'Extra access unavailable' USING ERRCODE='42501';
  END IF;
  IF extra.id IS NULL THEN
   IF EXISTS(SELECT 1 FROM public.event_add_ons WHERE id=p_extra_id) THEN
    RAISE EXCEPTION 'Extra action does not match' USING ERRCODE='22023';
   END IF;
   outcome:='confirmed';
  ELSIF EXISTS(SELECT 1 FROM public.order_add_ons a JOIN public.ticket_orders o ON o.id=a.order_id
    WHERE a.add_on_id=p_extra_id AND o.event_id=p_event_id AND o.status IN('paid','refunded')) THEN
   INSERT INTO public.creator_extra_history_settlements(request_id,page_id,event_id,user_id,extra_id)
    VALUES(p_request_id,p_page_id,p_event_id,auth.uid(),p_extra_id);
   outcome:='in_use';
  ELSE outcome:='unresolved';
  END IF;
 END IF;
 RETURN jsonb_build_object('outcome',outcome,'request_id',p_request_id,'page_id',p_page_id,
  'event_id',p_event_id,'user_id',auth.uid(),'extra_id',p_extra_id);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_creator_page_extra_removal(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.settle_creator_page_extra_removal(uuid,uuid,uuid,uuid) TO authenticated;
COMMIT;
