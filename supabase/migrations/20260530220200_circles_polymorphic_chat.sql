-- Circles (people + circles). 3/4: polymorphic chat parenting.
--
-- REVIEW ONLY. Not applied by the agent. See 1/4 header for prod-reconcile
-- notes. Verified 2026-05-30 against project upstjumasqblszevlgik:
--   * messages.event_id  uuid NOT NULL (today); chat_reads.event_id NOT NULL
--   * chat_reads unique = chat_reads_user_id_event_id_key on (user_id, event_id)
--   * messages live RLS (unchanged here):
--       SELECT "Event members can view messages" / INSERT "Event members can
--       send messages" both gate on event_members.event_id = messages.event_id.
--       For a circle row event_id IS NULL, so those EXISTS subqueries return
--       false and the event policies never match a circle row. The circle
--       policies added below are SEPARATE and OR-combine with them.
--   * chat_reads live RLS is purely auth.uid() = user_id (no membership gate),
--       so circle read-rows are already covered. NO new chat_reads policy here.
--
-- EXISTING-DATA VALIDITY: every current row has event_id NOT NULL and (after
-- the additive column) circle_id NULL, so the XOR check is satisfied by all
-- live rows. No backfill and no NOT VALID/VALIDATE two-step is needed; the
-- ADD CONSTRAINT validates cleanly against existing data.
--
-- This migration adds schema + constraints + RLS only. The client/useChat
-- changes that actually send/read circle messages are Step 3 (deferred).
--
-- Idempotent. Wrapped BEGIN/COMMIT with a final self-test DO block.

BEGIN;

-- ---------------------------------------------------------------------------
-- Additive nullable circle_id parent on both chat tables.
-- ---------------------------------------------------------------------------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS circle_id uuid REFERENCES public.circles(id) ON DELETE CASCADE;
ALTER TABLE public.chat_reads
  ADD COLUMN IF NOT EXISTS circle_id uuid REFERENCES public.circles(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- event_id becomes optional so a row can be parented by a circle instead.
-- ---------------------------------------------------------------------------
ALTER TABLE public.messages   ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE public.chat_reads ALTER COLUMN event_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- XOR: exactly one parent (event OR circle, never both, never neither).
-- Guarded ADD because Postgres has no ADD CONSTRAINT IF NOT EXISTS.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_parent_xor'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_parent_xor
      CHECK (
        (event_id IS NOT NULL AND circle_id IS NULL)
        OR (event_id IS NULL AND circle_id IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_reads_parent_xor'
  ) THEN
    ALTER TABLE public.chat_reads
      ADD CONSTRAINT chat_reads_parent_xor
      CHECK (
        (event_id IS NOT NULL AND circle_id IS NULL)
        OR (event_id IS NULL AND circle_id IS NOT NULL)
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- chat_reads uniqueness for circle rows. A PLAIN (non-partial) unique on
-- (user_id, circle_id): event rows have circle_id NULL and NULLs are distinct,
-- so events are unaffected; circle rows get one read-marker per user. It is
-- intentionally non-partial so the client read-path upsert can target it with
-- onConflict 'user_id,circle_id' (supabase-js emits no partial predicate, so a
-- partial index would not match the ON CONFLICT specification).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS chat_reads_user_id_circle_id_key
  ON public.chat_reads (user_id, circle_id);

-- ---------------------------------------------------------------------------
-- Lookup indexes for the circle chat path.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_messages_circle_created
  ON public.messages (circle_id, created_at)
  WHERE circle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_reads_circle_user
  ON public.chat_reads (circle_id, user_id)
  WHERE circle_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Separate circle RLS on messages. These OR-combine with the untouched event
-- policies. Membership is checked via the SECURITY DEFINER helper so the
-- subquery does not recurse into circle_members RLS. The INSERT policy pins
-- user_id = auth.uid() so a member cannot post as someone else. System
-- join/leave messages are written by SECURITY DEFINER RPCs, which bypass RLS,
-- so they are unaffected by this pin. (The event-branch INSERT policy is
-- membership-only and has the same spoofing gap; hardening it is a logged
-- security follow-up, intentionally not touched here.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Circle members can view messages" ON public.messages;
CREATE POLICY "Circle members can view messages" ON public.messages
  FOR SELECT TO authenticated
  USING (circle_id IS NOT NULL AND public.is_circle_member(circle_id, auth.uid()));

DROP POLICY IF EXISTS "Circle members can send messages" ON public.messages;
CREATE POLICY "Circle members can send messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    circle_id IS NOT NULL
    AND public.is_circle_member(circle_id, auth.uid())
    AND user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='messages' AND column_name='circle_id') THEN
    RAISE EXCEPTION 'messages.circle_id missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='chat_reads' AND column_name='circle_id') THEN
    RAISE EXCEPTION 'chat_reads.circle_id missing';
  END IF;
  -- event_id now nullable on both
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='messages'
      AND column_name='event_id' AND is_nullable='NO') THEN
    RAISE EXCEPTION 'messages.event_id should be nullable';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='chat_reads'
      AND column_name='event_id' AND is_nullable='NO') THEN
    RAISE EXCEPTION 'chat_reads.event_id should be nullable';
  END IF;
  -- XOR constraints
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='messages_parent_xor') THEN
    RAISE EXCEPTION 'messages_parent_xor missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chat_reads_parent_xor') THEN
    RAISE EXCEPTION 'chat_reads_parent_xor missing';
  END IF;
  -- existing rows satisfy the XOR (defensive: there must be no violators)
  IF EXISTS (
    SELECT 1 FROM public.messages
    WHERE NOT ((event_id IS NOT NULL AND circle_id IS NULL)
            OR (event_id IS NULL AND circle_id IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'existing messages violate the parent XOR';
  END IF;
END $$;

COMMIT;
