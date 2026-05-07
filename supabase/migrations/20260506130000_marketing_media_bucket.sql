-- Separate storage bucket for marketing-consented album uploads.
-- Documentation-only. Applied directly in production Supabase on 2026-05-06.
--
-- Why a second bucket: the album viewer always reads from album-media, but
-- there's no easy way to browse just the consented subset without building an
-- admin UI. With a public marketing-media bucket, Liz can scan the Supabase
-- dashboard organized by event_id and pull anything consented for use.
--
-- The client copies the same bytes into this bucket on a successful upload
-- when batch.options.marketingConsent is true. The copy is best-effort and
-- never blocks the main album-media upload.
--
-- Path layout matches album-media exactly: {event_id}/{user_id}/{upload_id}/original.{ext}
--
-- Storage policies mirror album-media's INSERT (joined member only) and
-- DELETE (own path[2] only). SELECT differs: marketing-media is public so
-- direct URLs work for sharing into marketing tools.

INSERT INTO storage.buckets (id, name, public)
VALUES ('marketing-media', 'marketing-media', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "users can upload to marketing-media for joined events" ON storage.objects;
CREATE POLICY "users can upload to marketing-media for joined events"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'marketing-media'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM event_members em
      WHERE em.event_id::text = (storage.foldername(name))[1]
        AND em.user_id = auth.uid()
        AND em.status = 'joined'
    )
  );

DROP POLICY IF EXISTS "authenticated read marketing-media" ON storage.objects;
CREATE POLICY "authenticated read marketing-media"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'marketing-media');

DROP POLICY IF EXISTS "users delete own marketing-media objects" ON storage.objects;
CREATE POLICY "users delete own marketing-media objects"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'marketing-media'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DO $$
DECLARE
  v_policy_count int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'marketing-media' AND public = true) THEN
    RAISE EXCEPTION 'marketing-media bucket missing or not public';
  END IF;
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND (
      policyname = 'users can upload to marketing-media for joined events'
      OR policyname = 'authenticated read marketing-media'
      OR policyname = 'users delete own marketing-media objects'
    );
  IF v_policy_count <> 3 THEN
    RAISE EXCEPTION 'marketing-media: expected 3 storage policies, found %', v_policy_count;
  END IF;
END
$$ LANGUAGE plpgsql;
