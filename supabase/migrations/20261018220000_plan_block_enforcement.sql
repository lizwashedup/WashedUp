-- Server enforcement for both block stores. No evidence/message deletion.
-- A short transaction mutex orders block changes and admissions. It also covers
-- SECURITY DEFINER entry points, which bypass RLS. Rejected/deadlocked writes
-- roll back rather than reporting a successful block with retained access.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION public.lock_plan_block_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(731018, 1);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.lock_plan_block_changes() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER aa_lock_plan_block_changes BEFORE UPDATE OF blocked_users ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.lock_plan_block_changes();
CREATE TRIGGER aa_lock_plan_block_changes BEFORE INSERT OR UPDATE ON public.user_blocks
FOR EACH ROW EXECUTE FUNCTION public.lock_plan_block_changes();

CREATE FUNCTION public.enforce_plan_block_pair(p_blocker uuid, p_blocked uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_blocker IS NULL OR p_blocked IS NULL OR p_blocker = p_blocked THEN RETURN; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(731018, 1);
  UPDATE public.event_interest_signals SET status='expired', expired_at=now(), expiry_reason='blocked'
  WHERE status='active' AND ((interested_user_id=p_blocker AND creator_id=p_blocked)
    OR (interested_user_id=p_blocked AND creator_id=p_blocker));
  -- Preserve the existing direction: remove the blocked guest; when the
  -- blocked person created the plan, remove the blocker instead. Never rely
  -- on a client-editable role to decide who actually owns the plan.
  UPDATE public.event_members m SET status='removed'
  FROM public.events e WHERE e.id=m.event_id AND e.status IN ('forming','full','draft')
    AND m.status='joined' AND m.user_id IS DISTINCT FROM e.creator_user_id
    AND ((m.user_id=p_blocked AND EXISTS(SELECT 1 FROM public.event_members peer
      WHERE peer.event_id=m.event_id AND peer.user_id=p_blocker AND peer.status='joined'))
    OR (m.user_id=p_blocker AND e.creator_user_id=p_blocked));
  -- A queued invitation must not bring the removed guest back into this plan.
  DELETE FROM public.event_waitlist w USING public.events e
  WHERE w.event_id=e.id AND ((w.user_id=p_blocked AND e.creator_user_id=p_blocker)
    OR (w.user_id=p_blocker AND e.creator_user_id=p_blocked));
  DELETE FROM public.waitlist_notification_queue q USING public.events e
  WHERE q.event_id=e.id AND ((q.user_id=p_blocked AND e.creator_user_id=p_blocker)
    OR (q.user_id=p_blocker AND e.creator_user_id=p_blocked));
END $$;
REVOKE ALL ON FUNCTION public.enforce_plan_block_pair(uuid,uuid) FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF md5(pg_get_functiondef('public.expire_interests_on_block()'::regprocedure))
    <> '9d93bd840db4a2780930953bff348da1' THEN
    RAISE EXCEPTION 'Block cleanup source changed since review';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.expire_interests_on_block() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_added uuid;
BEGIN
  FOR v_added IN SELECT DISTINCT x FROM unnest(coalesce(NEW.blocked_users,'{}'::uuid[])) x
    WHERE NOT x=ANY(coalesce(OLD.blocked_users,'{}'::uuid[]))
  LOOP
    PERFORM public.enforce_plan_block_pair(NEW.id,v_added);
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.expire_interests_on_block() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.enforce_table_plan_block() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.enforce_plan_block_pair(NEW.blocker_id,NEW.blocked_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_table_plan_block() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_table_plan_block AFTER INSERT OR UPDATE ON public.user_blocks
FOR EACH ROW EXECUTE FUNCTION public.enforce_table_plan_block();

CREATE FUNCTION public.guard_plan_membership_contact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_creator uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'joined' THEN RETURN NEW; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(731018, 1);
  IF EXISTS(SELECT 1 FROM public.profiles WHERE id=NEW.user_id AND suspended_until>now()) THEN
    RAISE EXCEPTION 'account on hold' USING ERRCODE='42501';
  END IF;
  SELECT creator_user_id INTO v_creator FROM public.events WHERE id=NEW.event_id;
  IF v_creator IS NULL THEN RAISE EXCEPTION 'plan unavailable' USING ERRCODE='42501'; END IF;
  IF NEW.user_id<>v_creator AND (
    public.yours_is_blocked_between(NEW.user_id,v_creator) IS DISTINCT FROM false
    OR EXISTS(SELECT 1 FROM public.event_members peer WHERE peer.event_id=NEW.event_id
      AND peer.status='joined' AND peer.user_id<>NEW.user_id
      AND public.yours_is_blocked_between(NEW.user_id,peer.user_id) IS DISTINCT FROM false)) THEN
    RAISE EXCEPTION 'plan unavailable' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_plan_membership_contact() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER aa_guard_plan_membership_contact BEFORE INSERT OR UPDATE OF status,event_id,user_id,role
ON public.event_members FOR EACH ROW EXECUTE FUNCTION public.guard_plan_membership_contact();

CREATE FUNCTION public.plan_chat_contact_allowed(p_event_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.event_members m JOIN public.events e ON e.id=m.event_id
    WHERE m.event_id=p_event_id AND m.user_id=auth.uid() AND m.status='joined'
    AND (m.user_id=e.creator_user_id OR
      public.yours_is_blocked_between(m.user_id,e.creator_user_id) IS FALSE));
$$;
REVOKE ALL ON FUNCTION public.plan_chat_contact_allowed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_chat_contact_allowed(uuid) TO authenticated, service_role;
CREATE POLICY plan_block_message_select ON public.messages AS RESTRICTIVE FOR SELECT TO authenticated
USING (event_id IS NULL OR public.is_admin(auth.uid()) OR public.plan_chat_contact_allowed(event_id));
CREATE POLICY plan_block_message_insert ON public.messages AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (event_id IS NULL OR public.plan_chat_contact_allowed(event_id));
CREATE POLICY plan_block_message_update ON public.messages AS RESTRICTIVE FOR UPDATE TO authenticated
USING (event_id IS NULL OR public.plan_chat_contact_allowed(event_id))
WITH CHECK (event_id IS NULL OR public.plan_chat_contact_allowed(event_id));

-- Lock before RPC event/profile row locks, and guard definer edits explicitly.
DO $guard$
DECLARE item record; definition text; routine_oid oid;
BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('join_event_atomic','17410d6a40ac9bbefc9795c4ba74ed24',
  E'BEGIN\n',E'BEGIN\n  PERFORM pg_catalog.pg_advisory_xact_lock(731018, 1);\n'),
 ('join_circle_plan_atomic','662f7376dae0a6f3e5b485b3d75b5e33',
  E'BEGIN\n',E'BEGIN\n  PERFORM pg_catalog.pg_advisory_xact_lock(731018, 1);\n'),
 ('edit_own_chat_message','dd660acd4ee50da649dac601a73fef9d',
  E'BEGIN\n',E'BEGIN\n  PERFORM pg_catalog.pg_advisory_xact_lock(731018, 1);\n  IF p_kind = ''event'' AND public.plan_chat_contact_allowed(p_conversation_id) IS NOT TRUE THEN\n    RETURN jsonb_build_object(''status'',''unavailable'');\n  END IF;\n'),
 ('edit_own_chat_message_with_mentions','ac2f72109b59e936e394659261b4a3b0',
  E'BEGIN\n',E'BEGIN\n  PERFORM pg_catalog.pg_advisory_xact_lock(731018, 1);\n  IF p_kind = ''event'' AND public.plan_chat_contact_allowed(p_conversation_id) IS NOT TRUE THEN\n    RETURN jsonb_build_object(''status'',''unavailable'');\n  END IF;\n')
 ) expected(name,fingerprint,needle,replacement) LOOP
   SELECT p.oid INTO STRICT routine_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname=item.name;
   definition:=pg_get_functiondef(routine_oid);
   IF md5(definition)<>item.fingerprint OR
      (length(definition)-length(replace(definition,item.needle,'')))/length(item.needle)<>1 THEN
     RAISE EXCEPTION 'Plan routine changed since review: %',item.name;
   END IF;
   EXECUTE replace(definition,item.needle,item.replacement);
 END LOOP;
END $guard$;
NOTIFY pgrst, 'reload schema';
COMMIT;
