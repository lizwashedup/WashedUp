-- Storage policies for event-images bucket (plan photos)
-- App uploads to {user_id}/{timestamp}.jpg

-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload event images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'event-images'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow public read (bucket is public)
CREATE POLICY "Event images are publicly readable"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'event-images');
