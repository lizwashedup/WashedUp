-- REVIEW ONLY. Not in the migration runner; NOT deployed.
-- Existing unnamed two-person Circle chats must honor a mutual block even if
-- both people retain joined membership. Add restrictive policies, so an older
-- permissive policy cannot OR its way around this boundary. Keep existing
-- membership, sender-identity, history and reaction rules in force.
-- Before promotion: compare live schema/policy/RPC definitions and grants,
-- verify the canonical block helper, include the nine SECURITY DEFINER guards
-- in companion 20261007140000_private_chat_rpc_block_boundary.sql,
-- verify Realtime and push eligibility, then obtain Liz's deployment approval.
-- Does not delete history, sever memberships, or change group-chat semantics.
BEGIN;

CREATE OR REPLACE FUNCTION public.private_chat_contact_allowed(p_circle_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_viewer uuid := auth.uid();
  v_name text;
  v_members uuid[];
  v_other uuid;
BEGIN
  IF v_viewer IS NULL OR NOT public.is_circle_member(p_circle_id, v_viewer) THEN
    RETURN false;
  END IF;
  SELECT c.name INTO v_name FROM public.circles c WHERE c.id = p_circle_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF btrim(COALESCE(v_name, '')) <> '' THEN RETURN true; END IF;
  SELECT array_agg(cm.user_id) INTO v_members FROM public.circle_members cm
    WHERE cm.circle_id = p_circle_id AND cm.status = 'joined';
  IF cardinality(v_members) <> 2 THEN RETURN true; END IF;
  SELECT member INTO v_other FROM unnest(v_members) AS member WHERE member <> v_viewer;
  RETURN public.yours_is_blocked_between(v_viewer, v_other) IS FALSE;
END;
$$;
REVOKE ALL ON FUNCTION public.private_chat_contact_allowed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.private_chat_contact_allowed(uuid) TO authenticated;

CREATE POLICY private_chat_block_select ON public.messages AS RESTRICTIVE
FOR SELECT TO authenticated
USING (circle_id IS NULL OR public.private_chat_contact_allowed(circle_id));
CREATE POLICY private_chat_block_insert ON public.messages AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (circle_id IS NULL OR public.private_chat_contact_allowed(circle_id));
CREATE POLICY private_chat_block_update ON public.messages AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (circle_id IS NULL OR public.private_chat_contact_allowed(circle_id))
WITH CHECK (circle_id IS NULL OR public.private_chat_contact_allowed(circle_id));

-- Reactions must not provide another contact path on retained DM history.
-- Message SELECT above applies inside these invoker RLS expressions.
CREATE POLICY private_chat_reaction_select ON public.message_reactions AS RESTRICTIVE
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_reactions.message_id));
CREATE POLICY private_chat_reaction_insert ON public.message_reactions AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_reactions.message_id));
CREATE POLICY private_chat_reaction_update ON public.message_reactions AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_reactions.message_id))
WITH CHECK (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_reactions.message_id));
COMMIT;
