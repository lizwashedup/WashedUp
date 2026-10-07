-- Preserve existing chat image URLs/read policies and all other buckets.
-- Native community, Plan and web senders already write beneath auth.uid().
-- A restrictive boundary also applies when another permissive INSERT rule matches.
BEGIN;
CREATE POLICY chat_image_account_upload_boundary ON storage.objects
AS RESTRICTIVE FOR INSERT TO public
WITH CHECK (
  bucket_id <> 'chat-images'
  OR (auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text)
);
COMMIT;
