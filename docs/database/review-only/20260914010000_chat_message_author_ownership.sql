-- Review-only candidate, verified against the September 14 recovered schema.
-- Do not add to automatic migration replay or apply to a remote project yet.
-- Local API evidence: backend-recovery-2026-09-14/chat-transport-verification.json.
-- A joined Plan member could persist a message with another member's user_id.
-- Keep the existing membership, Circle, read/delete and service-role behavior.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'messages'
      AND policyname = 'Members can send messages' AND cmd = 'INSERT'
      AND roles = ARRAY['public']::name[]
      AND md5(with_check) = '64b79949e0ec6712d28fe4c2645d1238'
  ) THEN
    RAISE EXCEPTION 'Chat admission policy changed; reconcile before applying author ownership';
  END IF;
END;
$$;

-- Restrictive policies combine with AND, so other permissive membership
-- policies cannot bypass ownership. NULL authors also fail for signed-in users.
-- Existing trusted service-role writes continue to bypass RLS as before.
CREATE POLICY "messages_authenticated_author"
ON public.messages AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()));

COMMIT;
