-- Fix profile-photos RLS: allow root-level {uid}.jpg (app uploads user.id + '.jpg').
-- Run this in Supabase SQL Editor if you already applied the first migration and get
-- "new row violates row-level security policy" on upload.

DROP POLICY IF EXISTS "Users can upload their own photo" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own photo" ON storage.objects;

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
