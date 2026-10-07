-- Exact own-account readiness; never expose the email or enable delivery here.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_event_sales_alert_preference(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.event_sales_alert_preferences; verified boolean; ready boolean;
BEGIN
 IF NOT coalesce(public.attendee_message_is_event_organizer(p_event_id,auth.uid()),false) THEN
  RAISE EXCEPTION 'Sale alert access denied' USING ERRCODE='42501';
 END IF;
 SELECT * INTO s FROM public.event_sales_alert_preferences WHERE event_id=p_event_id AND user_id=auth.uid();
 SELECT EXISTS(SELECT FROM auth.users u WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL
   AND nullif(btrim(u.email),'') IS NOT NULL AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until<=now())) INTO verified;
 SELECT coalesce(verified AND sale_alerts_enabled AND (activation_mode='live' OR
  (activation_mode='seed_only' AND EXISTS(SELECT FROM public.delivery_seed_profiles WHERE profile_id=auth.uid()))),false)
 INTO ready FROM public.delivery_runtime_config WHERE singleton;
 RETURN jsonb_build_object('eventId',p_event_id,'userId',auth.uid(),'enabled',coalesce(s.enabled,false),
  'revision',s.revision,'updatedAt',s.updated_at,'emailVerified',verified,'deliveryReady',coalesce(ready,false));
END$$;
COMMENT ON FUNCTION public.get_event_sales_alert_preference(uuid) IS
 'Own event sale preference with verified account email and delivery-policy readiness. The delivery switch must remain off until worker/provider pairing is verified and authorized. Readiness is not evidence of a delivered email.';
COMMIT;
