-- Plan Albums: storage bucket, plan_photos table, plan_attendance table
-- Documentation-only. Applied directly in production Supabase on 2026-04-06.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Storage bucket: plan-albums (public access for authenticated users)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('plan-albums', 'plan-albums', true)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can upload
CREATE POLICY "Authenticated users can upload to plan-albums"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'plan-albums');

-- Authenticated users can read
CREATE POLICY "Authenticated users can read plan-albums"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'plan-albums');

-- Users can only delete their own uploads
CREATE POLICY "Users can delete own plan-albums objects"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'plan-albums' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. plan_photos table
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS plan_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('photo', 'video')),
  created_at timestamptz NOT NULL DEFAULT now(),
  is_developing boolean NOT NULL DEFAULT true,
  reveal_at timestamptz
);

ALTER TABLE plan_photos ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_plan_photos_event ON plan_photos (event_id);
CREATE INDEX idx_plan_photos_uploaded_by ON plan_photos (uploaded_by);

-- SELECT: active event members who are NOT marked as no-shows
CREATE POLICY "Event members can view photos if not marked no-show"
  ON plan_photos FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM event_members em
      WHERE em.event_id = plan_photos.event_id
        AND em.user_id = auth.uid()
        AND em.status = 'joined'
    )
    AND NOT EXISTS (
      SELECT 1 FROM plan_attendance pa
      WHERE pa.event_id = plan_photos.event_id
        AND pa.user_id = auth.uid()
        AND pa.was_present = false
    )
  );

-- INSERT: active event members can add photos
CREATE POLICY "Event members can upload photos"
  ON plan_photos FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM event_members em
      WHERE em.event_id = plan_photos.event_id
        AND em.user_id = auth.uid()
        AND em.status = 'joined'
    )
  );

-- UPDATE: only the uploader can update their own photos
CREATE POLICY "Users can update own photos"
  ON plan_photos FOR UPDATE TO authenticated
  USING (uploaded_by = auth.uid());

-- DELETE: only the uploader can delete their own photos
CREATE POLICY "Users can delete own photos"
  ON plan_photos FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════
-- 3. plan_attendance table
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS plan_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  was_present boolean NOT NULL DEFAULT true,
  marked_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id, marked_by)
);

ALTER TABLE plan_attendance ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_plan_attendance_event ON plan_attendance (event_id);
CREATE INDEX idx_plan_attendance_user ON plan_attendance (user_id);

-- SELECT: active event members can read attendance for their event
CREATE POLICY "Event members can view attendance"
  ON plan_attendance FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM event_members em
      WHERE em.event_id = plan_attendance.event_id
        AND em.user_id = auth.uid()
        AND em.status = 'joined'
    )
  );

-- INSERT: active event members can mark attendance for their event
CREATE POLICY "Event members can mark attendance"
  ON plan_attendance FOR INSERT TO authenticated
  WITH CHECK (
    marked_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM event_members em
      WHERE em.event_id = plan_attendance.event_id
        AND em.user_id = auth.uid()
        AND em.status = 'joined'
    )
  );
