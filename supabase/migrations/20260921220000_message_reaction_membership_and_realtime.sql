-- Plan/Circle/DM reactions use the same parent-membership boundary as messages.
-- The previous event-only SELECT hid Circle reactions; UPDATE had no policy.
BEGIN;

DROP POLICY IF EXISTS "Users can view reactions in their events" ON public.message_reactions;
CREATE POLICY "Members can view message reactions" ON public.message_reactions
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.messages m WHERE m.id = message_reactions.message_id
      AND (
        (m.circle_id IS NOT NULL AND public.is_circle_member(m.circle_id, (SELECT auth.uid())))
        OR EXISTS (SELECT 1 FROM public.event_members em WHERE em.event_id = m.event_id
          AND em.user_id = (SELECT auth.uid()) AND em.status = 'joined')
      )
  )
);

DROP POLICY IF EXISTS "Users can add reactions" ON public.message_reactions;
CREATE POLICY "Members can add own message reactions" ON public.message_reactions
FOR INSERT TO authenticated WITH CHECK (
  user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.messages m WHERE m.id = message_reactions.message_id
      AND (
        (m.circle_id IS NOT NULL AND public.is_circle_member(m.circle_id, (SELECT auth.uid())))
        OR EXISTS (SELECT 1 FROM public.event_members em WHERE em.event_id = m.event_id
          AND em.user_id = (SELECT auth.uid()) AND em.status = 'joined')
      )
  )
);

CREATE POLICY "Members can change own message reactions" ON public.message_reactions
FOR UPDATE TO authenticated USING (
  user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.messages m WHERE m.id = message_reactions.message_id
      AND (
        (m.circle_id IS NOT NULL AND public.is_circle_member(m.circle_id, (SELECT auth.uid())))
        OR EXISTS (SELECT 1 FROM public.event_members em WHERE em.event_id = m.event_id
          AND em.user_id = (SELECT auth.uid()) AND em.status = 'joined')
      )
  )
) WITH CHECK (user_id = (SELECT auth.uid()));

CREATE FUNCTION public.message_reaction_identity_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.message_id IS DISTINCT FROM OLD.message_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'message reaction identity cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER message_reaction_identity_guard BEFORE UPDATE ON public.message_reactions
FOR EACH ROW EXECUTE FUNCTION public.message_reaction_identity_immutable();

-- Existing table grants and RLS stay in force for realtime INSERT/UPDATE.
-- Keep default replica identity: DELETE exposes only the row's primary key.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_reactions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
  END IF;
END $$;
COMMIT;
