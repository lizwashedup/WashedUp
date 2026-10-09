-- REVIEW ONLY. Companion to 20261007120000_private_chat_block_boundary.sql.
-- NOT an active migration; NOT deployed. Apply both only after full review.
-- The live October 7 functions are SECURITY DEFINER and bypass message RLS.
-- Include Circle list/rename/invite/join paths that could reopen a blocked DM.
-- Preserve their exact bodies, ownership, signatures and grants, inserting only
-- the block guard. Abort atomically if any live definition changed since review.
-- Fingerprints are drift checks, not credential/security hashes.
BEGIN;
DO $guard$
DECLARE
  item record;
  routine_oid oid;
  definition text;
BEGIN
  IF to_regprocedure('public.private_chat_contact_allowed(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Install reviewed private-chat policy companion first';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('edit_own_chat_message', 'p_message_id uuid, p_kind text, p_conversation_id uuid, p_expected_content text, p_content text', '24435e62bdc5019d0a393faa67205c13',
     $needle$  ELSE
    PERFORM 1 FROM public.circle_members$needle$,
     $replacement$  ELSE
    IF public.private_chat_contact_allowed(p_conversation_id) IS NOT TRUE THEN
      RETURN jsonb_build_object('status','unavailable');
    END IF;
    PERFORM 1 FROM public.circle_members$replacement$),
    ('edit_own_chat_message_with_mentions', 'p_message_id uuid, p_kind text, p_conversation_id uuid, p_expected_content text, p_content text, p_expected_mentions jsonb, p_mentions jsonb', 'a62952a1c852c6170544835aa648bf09',
     $needle$  ELSE
    PERFORM 1 FROM public.circle_members$needle$,
     $replacement$  ELSE
    IF public.private_chat_contact_allowed(p_conversation_id) IS NOT TRUE THEN
      RETURN jsonb_build_object('status','unavailable');
    END IF;
    PERFORM 1 FROM public.circle_members$replacement$),
    ('get_circle', 'p_circle_id uuid', 'c2e9cad3927add1822e58080901631fb',
     $needle$ IF v_uid IS NULL OR NOT public.is_circle_member(p_circle_id, v_uid) THEN$needle$,
     $replacement$ IF v_uid IS NULL OR NOT public.is_circle_member(p_circle_id, v_uid)
 OR public.private_chat_contact_allowed(p_circle_id) IS NOT TRUE THEN$replacement$),
    ('get_circle_chat_messages', 'p_circle_id uuid, p_before_cursor timestamp with time zone, p_limit integer', 'b5644b027a0a93365562639a82fe7b0f',
     $needle$ IF v_uid IS NULL OR NOT public.is_circle_member(p_circle_id, v_uid) THEN$needle$,
     $replacement$ IF v_uid IS NULL OR NOT public.is_circle_member(p_circle_id, v_uid)
 OR public.private_chat_contact_allowed(p_circle_id) IS NOT TRUE THEN$replacement$),
    ('get_my_circle_chat_cards', '', 'c013dfbcd14e6a6f9658b77430eef363',
     $needle$ where mine.user_id = auth.uid() and mine.status = 'joined'$needle$,
     $replacement$ where mine.user_id = auth.uid() and mine.status = 'joined'
 and public.private_chat_contact_allowed(c.id) IS TRUE$replacement$),
    ('get_my_circles', '', '3d026f4ce1026a6a737c9272c119d3b7',
     $needle$    WHERE mine.user_id = v_uid AND mine.status = 'joined'$needle$,
     $replacement$    WHERE mine.user_id = v_uid AND mine.status = 'joined'
      AND public.private_chat_contact_allowed(c.id) IS TRUE$replacement$),
    ('invite_to_circle', 'p_circle_id uuid, p_user_ids uuid[]', '0c1663e55939914d7ba07b0b97a81cb3',
     $needle$  IF NOT public.is_circle_admin(p_circle_id, v_uid) THEN$needle$,
     $replacement$  IF public.private_chat_contact_allowed(p_circle_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'circle unavailable';
  END IF;
  IF NOT public.is_circle_admin(p_circle_id, v_uid) THEN$replacement$),
    ('join_circle_atomic', 'p_circle_id uuid', '904ed27658f47e1560851bb26d0115d6',
     $needle$  UPDATE public.circle_members
  SET status$needle$,
     $replacement$  -- Small unnamed rooms are private conversations, including a departed pair.
  -- An arbitrary third account must not turn a known DM ID into a group, and
  -- leaving/rejoining must not bypass a retained block. Named/larger groups
  -- retain their existing join behavior.
  IF btrim(COALESCE(v_circle.name, '')) = '' AND
     (SELECT count(*) FROM public.circle_members WHERE circle_id=p_circle_id) <= 2 THEN
    IF NOT EXISTS (SELECT 1 FROM public.circle_members WHERE circle_id=p_circle_id AND user_id=v_uid)
       OR EXISTS (SELECT 1 FROM public.circle_members cm WHERE cm.circle_id=p_circle_id
         AND cm.user_id<>v_uid AND public.yours_is_blocked_between(v_uid,cm.user_id) IS DISTINCT FROM false) THEN
      RETURN 'unavailable';
    END IF;
  END IF;

  UPDATE public.circle_members
  SET status$replacement$),
    ('update_circle', 'p_circle_id uuid, p_name text, p_description text, p_cover_upload_id uuid, p_room_enabled boolean, p_promote_user_ids uuid[], p_demote_user_ids uuid[], p_set_all_admins boolean, p_clear_cover boolean', '63532b9328bc1866e2eb47be67eef30f',
     $needle$  IF NOT public.is_circle_admin(p_circle_id, v_uid) THEN$needle$,
     $replacement$  IF public.private_chat_contact_allowed(p_circle_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'circle unavailable';
  END IF;
  IF NOT public.is_circle_admin(p_circle_id, v_uid) THEN$replacement$)
  ) expected(name, identity_args, fingerprint, needle, replacement)
  LOOP
    SELECT p.oid INTO routine_oid FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=item.name
      AND pg_get_function_identity_arguments(p.oid)=item.identity_args;
    IF routine_oid IS NULL THEN
      RAISE EXCEPTION 'Missing expected private-chat routine: %', item.name;
    END IF;
    definition := pg_get_functiondef(routine_oid);
    IF md5(definition) IS DISTINCT FROM item.fingerprint
      OR (length(definition)-length(replace(definition,item.needle,'')))
         / length(item.needle) <> 1 THEN
      RAISE EXCEPTION 'Private-chat routine changed since review: %', item.name;
    END IF;
    EXECUTE replace(definition,item.needle,item.replacement);
  END LOOP;
END;
$guard$;
COMMIT;
