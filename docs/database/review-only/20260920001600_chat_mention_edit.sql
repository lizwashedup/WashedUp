-- REVIEW ONLY / UNAPPLIED. Requires verified 20260920001500_chat_mention_identity.sql.
-- Preserve exact-room membership, writing-window, own-row and media checks.
-- Body and selected identities compare and update atomically under the same row lock.
BEGIN;
CREATE FUNCTION public.edit_own_chat_message_with_mentions(
  p_message_id uuid,
  p_kind text,
  p_conversation_id uuid,
  p_expected_content text,
  p_content text,
  p_expected_mentions jsonb,
  p_mentions jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_message public.messages%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_mentions jsonb;
  v_expected_mentions jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF p_message_id IS NULL OR p_conversation_id IS NULL OR p_kind IS NULL
     OR p_kind NOT IN ('event','circle') OR p_expected_content IS NULL
     OR p_content IS NULL OR length(btrim(p_content)) = 0 OR length(p_content) > 1000 THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  IF p_kind = 'event' THEN
    SELECT * INTO v_event FROM public.events WHERE id = p_conversation_id FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
    PERFORM 1 FROM public.event_members WHERE event_id = p_conversation_id
      AND user_id = v_uid AND status = 'joined' FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
    -- Same end-first 48-hour writing window as the native Plan chat.
    -- This does not install or change the separately held archive job.
    IF v_event.status::text = 'cancelled' OR statement_timestamp() >=
      (CASE WHEN v_event.end_time > v_event.start_time THEN v_event.end_time ELSE v_event.start_time END) + interval '48 hours' THEN
      RETURN jsonb_build_object('status','closed');
    END IF;
  ELSE
    PERFORM 1 FROM public.circle_members WHERE circle_id = p_conversation_id
      AND user_id = v_uid AND status = 'joined' FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  END IF;
  SELECT * INTO v_message FROM public.messages
    WHERE id = p_message_id AND user_id = v_uid
      AND ((p_kind = 'event' AND event_id = p_conversation_id AND circle_id IS NULL)
        OR (p_kind = 'circle' AND circle_id = p_conversation_id AND event_id IS NULL))
    FOR UPDATE;
  IF NOT FOUND OR v_message.message_type::text IS DISTINCT FROM 'user'
      OR v_message.image_url IS NOT NULL OR v_message.audio_url IS NOT NULL THEN
    RETURN jsonb_build_object('status','unavailable');
  END IF;
  v_mentions := public.validate_chat_mention_document(p_content,p_mentions);
  v_expected_mentions := public.validate_chat_mention_document(p_expected_content,p_expected_mentions);
  IF v_message.content = p_content
    AND coalesce(v_message.mention_data->'references','[]'::jsonb) = coalesce(v_mentions->'references','[]'::jsonb) THEN
    RETURN jsonb_build_object('status','saved','id',v_message.id,'content',v_message.content,'mention_data',v_message.mention_data);
  END IF;
  IF v_message.content IS DISTINCT FROM p_expected_content
    OR coalesce(v_message.mention_data->'references','[]'::jsonb) IS DISTINCT FROM coalesce(v_expected_mentions->'references','[]'::jsonb) THEN
    RETURN jsonb_build_object('status','changed');
  END IF;
  UPDATE public.messages SET content = p_content, mention_data = v_mentions WHERE id = v_message.id;
  RETURN jsonb_build_object('status','saved','id',v_message.id,'content',p_content,'mention_data',v_mentions);
END;
$$;
REVOKE ALL ON FUNCTION public.edit_own_chat_message_with_mentions(uuid,text,uuid,text,text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_own_chat_message_with_mentions(uuid,text,uuid,text,text,jsonb,jsonb) TO authenticated;
COMMENT ON FUNCTION public.edit_own_chat_message_with_mentions(uuid,text,uuid,text,text,jsonb,jsonb) IS
  'Own text and explicit mention edit with current exact-room membership, Plan writing window, expected-content and identity comparison and exact receipt. No general message UPDATE access.';
COMMIT;
