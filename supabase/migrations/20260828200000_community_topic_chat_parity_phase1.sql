-- Community chat parity: topic reactions, replies, images, and editing;
-- member-message images and editing in the main community thread (additive).
--
-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD. Written for 75-threshold spec item 1b
-- (specs/washedup-75-THRESHOLD-SPEC-v1-20260828.md). Companion to a new
-- useTopicChat hook -- this migration only adds schema and policies. It leaves
-- community_broadcast_reactions/replies unchanged because those are already
-- live, while extending ordinary community_broadcasts member messages for the
-- shorter photo/edit/delete parity pass.
--
-- Scope: community_topic_messages plus ordinary kind='message' rows in the
-- main community thread. Additive only -- no existing column renamed, no
-- existing row touched, no data moved.
-- Mirrors the shape of the existing public.message_reactions table (used by
-- plan and circle chat) so reaction logic patterns can carry over. Does NOT
-- touch public.messages or its messages_parent_xor constraint -- a full merge
-- into public.messages (extending useChat/ChatThread with a 3rd 'community_topic'
-- kind) was considered and deferred: community_topic_messages already holds
-- live message history (e.g. a real 19-member room), and moving that into
-- public.messages would need an explicit, carefully-sequenced data migration,
-- not just an additive schema change. See the build-plan writeup for the full
-- reasoning either way.
--
-- Idempotent. Wrapped BEGIN/COMMIT with a final self-test DO block, same
-- pattern as 20260530220200_circles_polymorphic_chat.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- Additive columns on community_topic_messages: image, reply-to, edited flag.
-- ---------------------------------------------------------------------------
ALTER TABLE public.community_topic_messages
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS reply_to_message_id uuid REFERENCES public.community_topic_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- A photo may be sent without a caption. Text-only messages still require
-- non-blank content, and every body remains bounded at 4,000 characters.
ALTER TABLE public.community_topic_messages
  DROP CONSTRAINT IF EXISTS community_topic_messages_body_check;
ALTER TABLE public.community_topic_messages
  ADD CONSTRAINT community_topic_messages_body_check
  CHECK (
    char_length(body) <= 4000
    AND (char_length(btrim(body)) > 0 OR image_url IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_community_topic_messages_reply_to
  ON public.community_topic_messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

DROP POLICY IF EXISTS community_topic_messages_update_own ON public.community_topic_messages;
CREATE POLICY community_topic_messages_update_own ON public.community_topic_messages
  FOR UPDATE
  USING (sender_id = (select auth.uid()))
  WITH CHECK (
    sender_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.community_topics t
      WHERE t.id = community_topic_messages.topic_id
        AND NOT t.archived
        AND is_topic_member(t.id, (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- Reactions, same shape as public.message_reactions (message_id, user_id,
-- reaction), scoped to topic messages instead of plan/circle messages.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_topic_message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.community_topic_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

ALTER TABLE public.community_topic_message_reactions ENABLE ROW LEVEL SECURITY;

-- Membership check reuses is_topic_member(topic_id, user_id), the same
-- SECURITY DEFINER helper community_topic_messages_select/_insert already use
-- (see 20260707120000_event_chat_model.sql lines 62-98).
DROP POLICY IF EXISTS community_topic_message_reactions_select ON public.community_topic_message_reactions;
CREATE POLICY community_topic_message_reactions_select ON public.community_topic_message_reactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.community_topic_messages m
      WHERE m.id = community_topic_message_reactions.message_id
        AND is_topic_member(m.topic_id, (select auth.uid()))
    )
    OR is_admin((select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role)
  );

-- Review finding 2026-08-29: insert/update must block a room's reactions the
-- same way community_topic_messages_update_own already blocks edits once a
-- topic is archived -- select/delete stay unrestricted so history keeps
-- rendering and members can still remove their own reaction from a closed room.
DROP POLICY IF EXISTS community_topic_message_reactions_insert ON public.community_topic_message_reactions;
CREATE POLICY community_topic_message_reactions_insert ON public.community_topic_message_reactions
  FOR INSERT WITH CHECK (
    user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.community_topic_messages m
      JOIN public.community_topics t ON t.id = m.topic_id
      WHERE m.id = community_topic_message_reactions.message_id
        AND NOT t.archived
        AND is_topic_member(m.topic_id, (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS community_topic_message_reactions_delete ON public.community_topic_message_reactions;
CREATE POLICY community_topic_message_reactions_delete ON public.community_topic_message_reactions
  FOR DELETE USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS community_topic_message_reactions_update ON public.community_topic_message_reactions;
CREATE POLICY community_topic_message_reactions_update ON public.community_topic_message_reactions
  FOR UPDATE
  USING (user_id = (select auth.uid()))
  WITH CHECK (
    user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.community_topic_messages m
      JOIN public.community_topics t ON t.id = m.topic_id
      WHERE m.id = community_topic_message_reactions.message_id
        AND NOT t.archived
        AND is_topic_member(m.topic_id, (select auth.uid()))
    )
  );

CREATE INDEX IF NOT EXISTS idx_community_topic_message_reactions_message
  ON public.community_topic_message_reactions (message_id);

-- Reactions need the same live refresh path as their parent messages.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.community_topic_message_reactions;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Main community thread parity for ordinary member messages. Broadcast and
-- intro rows retain their existing product behavior; only kind='message' gets
-- the member self-edit/delete policies and optional image content.
-- ---------------------------------------------------------------------------
ALTER TABLE public.community_broadcasts
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

ALTER TABLE public.community_broadcasts
  DROP CONSTRAINT IF EXISTS community_broadcasts_body_check;
ALTER TABLE public.community_broadcasts
  ADD CONSTRAINT community_broadcasts_body_check
  CHECK (
    char_length(body) <= 4000
    AND (
      (kind = 'message' AND (char_length(btrim(body)) > 0 OR image_url IS NOT NULL))
      OR (kind <> 'message' AND char_length(body) > 0)
    )
  );

DROP POLICY IF EXISTS community_broadcasts_member_update_own ON public.community_broadcasts;
CREATE POLICY community_broadcasts_member_update_own ON public.community_broadcasts
  FOR UPDATE
  USING (kind = 'message' AND sender_id = (select auth.uid()))
  WITH CHECK (
    kind = 'message'
    AND sender_id = (select auth.uid())
    AND is_community_member(community_id, (select auth.uid()))
  );

DROP POLICY IF EXISTS community_broadcasts_member_delete_own ON public.community_broadcasts;
CREATE POLICY community_broadcasts_member_delete_own ON public.community_broadcasts
  FOR DELETE
  USING (kind = 'message' AND sender_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='community_topic_messages' AND column_name='image_url') THEN
    RAISE EXCEPTION 'community_topic_messages.image_url missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='community_topic_messages' AND column_name='reply_to_message_id') THEN
    RAISE EXCEPTION 'community_topic_messages.reply_to_message_id missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='community_topic_messages' AND column_name='edited_at') THEN
    RAISE EXCEPTION 'community_topic_messages.edited_at missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='community_topic_message_reactions') THEN
    RAISE EXCEPTION 'community_topic_message_reactions missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='community_broadcasts' AND column_name='image_url') THEN
    RAISE EXCEPTION 'community_broadcasts.image_url missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='community_broadcasts' AND column_name='edited_at') THEN
    RAISE EXCEPTION 'community_broadcasts.edited_at missing';
  END IF;
END $$;

COMMIT;
