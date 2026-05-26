-- Chat upgrade Phase 1 / Component 5: voice messages.
--
-- IMPORTANT: on prod, messages.message_type is a Postgres ENUM (public.message_type
-- with values user, system, location), NOT a text column with a CHECK constraint.
-- So 'audio' is added with ALTER TYPE ... ADD VALUE, not a constraint edit.
--
-- Storage path pattern for voice messages: {event_id}/{user_id}/{timestamp}.m4a
-- (mirrors the chat-images / marketing-media buckets so RLS can check the
-- uploader's own folder + joined-member status the same way).

-- 1. New columns on messages (additive, nullable, safe to ship before client).
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS audio_url text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS duration_seconds integer;

-- 2. Extend the message_type enum with 'audio'. Idempotent. Safe inside a
--    transaction on PG12+ as long as the new value is not USED in the same
--    transaction (it is not — nothing below inserts an 'audio' row).
ALTER TYPE public.message_type ADD VALUE IF NOT EXISTS 'audio';

-- 3. Storage bucket for voice messages.
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-audio', 'chat-audio', true)
ON CONFLICT (id) DO NOTHING;

-- 4. RLS on storage.objects for chat-audio (modeled on marketing-media bucket).
--    INSERT: authenticated, uploading into their own user folder, and a joined
--            member of the event the file belongs to.
CREATE POLICY "users upload to chat-audio for joined events"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-audio'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.event_members em
      WHERE em.event_id::text = (storage.foldername(name))[1]
        AND em.user_id = auth.uid()
        AND em.status = 'joined'
    )
  );

--    SELECT: any authenticated user can read (bucket is public within the app,
--            matching chat-images behavior).
CREATE POLICY "authenticated read chat-audio"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chat-audio');

--    DELETE: only the uploader can remove their own objects.
CREATE POLICY "users delete own chat-audio objects"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-audio'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
