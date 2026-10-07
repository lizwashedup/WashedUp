-- Complete the existing creator welcome contract in the isolated candidate.
-- The retained message ID is the receipt; no new room or notification system.
BEGIN;
CREATE OR REPLACE FUNCTION public.set_event_chat_welcome_message(
  p_event_id uuid, p_message text, p_message_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_event record;
  v_topic record;
  v_saved record;
  v_body text := nullif(btrim(p_message), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE='42501'; END IF;
  SELECT id, host_user_id, community_id INTO v_event FROM public.explore_events WHERE id=p_event_id;
  IF v_event.id IS NULL OR NOT coalesce(v_event.host_user_id=v_uid OR
    (v_event.community_id IS NOT NULL AND public.is_community_leader(v_event.community_id,v_uid)),false)
  THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  IF p_message_id IS NULL OR v_body IS NULL OR char_length(v_body)>4000
  THEN RAISE EXCEPTION 'Write a welcome message of up to 4000 characters.' USING ERRCODE='22023'; END IF;
  SELECT id, archived INTO v_topic FROM public.community_topics WHERE explore_event_id=p_event_id FOR UPDATE;
  IF v_topic.id IS NULL THEN RAISE EXCEPTION 'This event has no conversation.' USING ERRCODE='23514'; END IF;
  SELECT id,topic_id,sender_id,body,created_at INTO v_saved FROM public.community_topic_messages WHERE id=p_message_id;
  IF FOUND THEN
    IF v_saved.topic_id<>v_topic.id OR v_saved.sender_id<>v_uid OR v_saved.body<>v_body
    THEN RAISE EXCEPTION 'The original welcome request differs.' USING ERRCODE='23514'; END IF;
    RETURN jsonb_build_object('id',v_saved.id,'created_at',v_saved.created_at);
  END IF;
  IF v_topic.archived OR EXISTS(SELECT FROM public.community_topic_messages WHERE topic_id=v_topic.id)
  THEN RAISE EXCEPTION 'A welcome can only be added to an empty, open conversation.' USING ERRCODE='23514'; END IF;
  INSERT INTO public.community_topic_messages(id,topic_id,sender_id,body)
  VALUES(p_message_id,v_topic.id,v_uid,v_body) RETURNING id,created_at INTO v_saved;
  RETURN jsonb_build_object('id',v_saved.id,'created_at',v_saved.created_at);
END;
$$;
REVOKE ALL ON FUNCTION public.set_event_chat_welcome_message(uuid,text,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.set_event_chat_welcome_message(uuid,text,uuid) TO authenticated;

-- Preserve existing native/legacy callers and their empty-room semantics.
CREATE OR REPLACE FUNCTION public.set_event_chat_welcome_message(p_event_id uuid,p_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.set_event_chat_welcome_message(p_event_id,p_message,gen_random_uuid());
END;
$$;
REVOKE ALL ON FUNCTION public.set_event_chat_welcome_message(uuid,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.set_event_chat_welcome_message(uuid,text) TO authenticated;
COMMIT;
