-- REVIEW ONLY. Not applied. Pair with identity-aware send/edit/read/receipt
-- clients and notification integration before enabling person-specific tags.
-- No RLS policy, existing RPC, notification trigger or provider flag changes.
BEGIN;

ALTER TABLE public.messages ADD COLUMN mention_data jsonb;
ALTER TABLE public.community_topic_messages ADD COLUMN mention_data jsonb;
ALTER TABLE public.community_broadcasts ADD COLUMN mention_data jsonb;

CREATE FUNCTION public.validate_chat_mention_document(p_text text, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  r jsonb; v_start integer; v_end integer; v_previous_end integer := 0;
  v_label text; v_uid uuid; v_refs jsonb := '[]'::jsonb; v_before text;
BEGIN
  IF p_data IS NULL THEN RETURN NULL; END IF;
  IF p_text IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object'
    OR p_data->'version' IS DISTINCT FROM '1'::jsonb
    OR p_data->>'text' IS DISTINCT FROM p_text
    OR jsonb_typeof(p_data->'references') IS DISTINCT FROM 'array'
    OR octet_length(p_data::text) > 64000 THEN
    RAISE EXCEPTION 'Invalid mention data' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_data->'references') > 128 THEN
    RAISE EXCEPTION 'Invalid mention data' USING ERRCODE='22023';
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_data->'references') LOOP
    IF jsonb_typeof(r) IS DISTINCT FROM 'object'
      OR jsonb_typeof(r->'userId') IS DISTINCT FROM 'string'
      OR coalesce(r->>'userId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR jsonb_typeof(r->'label') IS DISTINCT FROM 'string'
      OR length(btrim(r->>'label')) = 0 OR length(r->>'label') > 100
      OR jsonb_typeof(r->'start') IS DISTINCT FROM 'number'
      OR jsonb_typeof(r->'end') IS DISTINCT FROM 'number'
      OR coalesce(r->>'start','') !~ '^[0-9]{1,8}$'
      OR coalesce(r->>'end','') !~ '^[0-9]{1,8}$' THEN
      RAISE EXCEPTION 'Invalid mention data' USING ERRCODE='22023';
    END IF;
    v_start := (r->>'start')::integer; v_end := (r->>'end')::integer;
    v_uid := (r->>'userId')::uuid; v_label := r->>'label';
    IF v_start < v_previous_end OR v_end <= v_start OR v_end > length(p_text)
      OR substring(p_text FROM v_start+1 FOR v_end-v_start) IS DISTINCT FROM '@'||v_label THEN
      RAISE EXCEPTION 'Invalid mention range' USING ERRCODE='22023';
    END IF;
    v_before := left(p_text,v_start);
    IF (v_start > 0 AND right(v_before,1) !~ '[[:space:]\(\[\{]')
      OR substring(v_before FROM '[^[:space:]]+$') ~* '(https?://|www\.)'
      OR substring(p_text FROM v_end+1 FOR 1) ~ '[[:alnum:]_''’\-]' THEN
      RAISE EXCEPTION 'Invalid mention range' USING ERRCODE='22023';
    END IF;
    v_refs := v_refs || jsonb_build_array(jsonb_build_object('userId',v_uid,'label',v_label,'start',v_start,'end',v_end));
    v_previous_end := v_end;
  END LOOP;
  RETURN jsonb_build_object('version',1,'text',p_text,'references',v_refs);
END;
$$;
REVOKE ALL ON FUNCTION public.validate_chat_mention_document(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.guard_chat_mention_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_text text; v_sender uuid; v_ref jsonb; v_id uuid; v_label text;
  v_old jsonb := '[]'::jsonb; v_valid boolean; v_unchanged_label boolean;
BEGIN
  IF TG_TABLE_NAME='messages' THEN v_text:=NEW.content; v_sender:=NEW.user_id;
  ELSE v_text:=NEW.body; v_sender:=NEW.sender_id; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.mention_data IS NOT DISTINCT FROM OLD.mention_data THEN
      -- Older clients cannot carry ranges across edits. Remove stale tags
      -- atomically with their text edit instead of retaining wrong recipients.
      IF NEW.mention_data->>'text' IS DISTINCT FROM v_text THEN NEW.mention_data:=NULL; END IF;
      RETURN NEW;
    END IF;
    v_old:=coalesce(OLD.mention_data->'references','[]'::jsonb);
  END IF;
  IF NEW.mention_data IS NULL THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR v_sender IS DISTINCT FROM auth.uid()
    OR (TG_TABLE_NAME='messages' AND to_jsonb(NEW)->>'message_type' IS DISTINCT FROM 'user')
    OR (TG_TABLE_NAME='community_broadcasts' AND to_jsonb(NEW)->>'kind' IS DISTINCT FROM 'message') THEN
    RAISE EXCEPTION 'Mention unavailable' USING ERRCODE='42501';
  END IF;
  NEW.mention_data:=public.validate_chat_mention_document(v_text,NEW.mention_data);
  FOR v_ref IN SELECT value FROM jsonb_array_elements(NEW.mention_data->'references') LOOP
    v_id:=(v_ref->>'userId')::uuid; v_label:=v_ref->>'label'; v_valid:=false;
    IF TG_TABLE_NAME='messages' THEN
      IF NEW.event_id IS NOT NULL AND NEW.circle_id IS NULL THEN
        PERFORM 1 FROM public.event_members WHERE event_id=NEW.event_id AND user_id=v_id AND status='joined' FOR SHARE;
      ELSIF NEW.circle_id IS NOT NULL AND NEW.event_id IS NULL THEN
        PERFORM 1 FROM public.circle_members WHERE circle_id=NEW.circle_id AND user_id=v_id AND status='joined' FOR SHARE;
      ELSE RAISE EXCEPTION 'Mention unavailable' USING ERRCODE='42501'; END IF;
      v_valid:=FOUND;
    ELSIF TG_TABLE_NAME='community_topic_messages' THEN
      PERFORM 1 FROM public.community_topic_members WHERE topic_id=NEW.topic_id AND user_id=v_id FOR SHARE;
      v_valid:=FOUND;
    ELSIF TG_TABLE_NAME='community_broadcasts' THEN
      PERFORM 1 FROM public.community_members WHERE community_id=NEW.community_id AND user_id=v_id AND status='active' FOR SHARE;
      v_valid:=FOUND;
    END IF;
    IF NOT v_valid OR (v_id<>v_sender AND public.yours_is_blocked_between(v_sender,v_id)) THEN
      RAISE EXCEPTION 'Mention unavailable' USING ERRCODE='42501';
    END IF;
    -- Preserve an already-validated historical label through a name change;
    -- new recipients must use the name currently exposed by the public profile.
    SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(v_old) old_ref
      WHERE old_ref->>'userId'=v_id::text AND old_ref->>'label'=v_label) INTO v_unchanged_label;
    IF NOT v_unchanged_label AND NOT EXISTS(SELECT 1 FROM public.profiles_public
      WHERE id=v_id AND first_name_display=v_label) THEN
      RAISE EXCEPTION 'Mention unavailable' USING ERRCODE='42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_chat_mention_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER chat_mention_identity BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_chat_mention_identity();
CREATE TRIGGER chat_mention_identity BEFORE INSERT OR UPDATE ON public.community_topic_messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_chat_mention_identity();
CREATE TRIGGER chat_mention_identity BEFORE INSERT OR UPDATE ON public.community_broadcasts
  FOR EACH ROW EXECUTE FUNCTION public.guard_chat_mention_identity();
COMMIT;
