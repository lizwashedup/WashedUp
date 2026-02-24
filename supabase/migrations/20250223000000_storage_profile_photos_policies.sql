-- Storage policies for profile-photos bucket
-- App uploads to root as {user.id}.jpg; also allow {user.id}/... for future.
-- Run in Supabase SQL Editor or via: supabase db push

CREATE POLICY "Users can upload their own photo"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-photos'
  AND (
    name = (auth.uid()::text || '.jpg')
    OR auth.uid()::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "Users can update their own photo"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND (
    name = (auth.uid()::text || '.jpg')
    OR auth.uid()::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "Anyone can view photos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'profile-photos');
