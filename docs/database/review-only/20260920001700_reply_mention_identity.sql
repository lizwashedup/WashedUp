-- REVIEW ONLY. Depends on 20260920001500_chat_mention_identity.sql.
-- Pair with reply composer/receipt/history integration before enablement.
-- Existing reply membership policies, grants and notification triggers stay intact.
BEGIN;
ALTER TABLE public.community_broadcast_replies ADD COLUMN mention_data jsonb;
CREATE FUNCTION public.guard_reply_mention_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_community uuid; v_ref jsonb; v_recipient uuid; v_old jsonb := '[]'::jsonb;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.mention_data IS NOT DISTINCT FROM OLD.mention_data THEN
      IF NEW.mention_data->>'text' IS DISTINCT FROM NEW.body THEN NEW.mention_data:=NULL; END IF;
      RETURN NEW;
    END IF;
    v_old:=coalesce(OLD.mention_data->'references','[]'::jsonb);
  END IF;
  IF NEW.mention_data IS NULL THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR NEW.sender_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Mention unavailable' USING ERRCODE='42501';
  END IF;
  SELECT b.community_id INTO v_community FROM public.community_broadcasts b
    JOIN public.community_members m ON m.community_id=b.community_id
      AND m.user_id=NEW.sender_id AND m.status='active'
    WHERE b.id=NEW.broadcast_id FOR SHARE OF b,m;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mention unavailable' USING ERRCODE='42501'; END IF;
  NEW.mention_data:=public.validate_chat_mention_document(NEW.body,NEW.mention_data);
  FOR v_ref IN SELECT value FROM jsonb_array_elements(NEW.mention_data->'references') LOOP
    v_recipient:=(v_ref->>'userId')::uuid;
    PERFORM 1 FROM public.community_members WHERE community_id=v_community
      AND user_id=v_recipient AND status='active' FOR SHARE;
    IF NOT FOUND OR (v_recipient<>NEW.sender_id AND public.yours_is_blocked_between(NEW.sender_id,v_recipient)) THEN
      RAISE EXCEPTION 'Mention unavailable' USING ERRCODE='42501';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_old) old_ref
      WHERE old_ref->>'userId'=v_recipient::text AND old_ref->>'label'=v_ref->>'label')
      AND NOT EXISTS(SELECT 1 FROM public.profiles_public
        WHERE id=v_recipient AND first_name_display=v_ref->>'label') THEN
      RAISE EXCEPTION 'Mention unavailable' USING ERRCODE='42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_reply_mention_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER chat_mention_identity BEFORE INSERT OR UPDATE ON public.community_broadcast_replies
  FOR EACH ROW EXECUTE FUNCTION public.guard_reply_mention_identity();
COMMIT;
