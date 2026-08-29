DROP POLICY IF EXISTS "users upload to chat-audio for joined events" ON storage.objects;

CREATE POLICY "users upload to chat-audio for joined events or circles"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-audio'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND (
      EXISTS (
        SELECT 1 FROM public.event_members em
        WHERE em.event_id::text = (storage.foldername(name))[1]
          AND em.user_id = auth.uid()
          AND em.status = 'joined'
      )
      OR EXISTS (
        SELECT 1 FROM public.circle_members cm
        WHERE cm.circle_id::text = (storage.foldername(name))[1]
          AND cm.user_id = auth.uid()
          AND cm.status = 'joined'
      )
    )
  );
