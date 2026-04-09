-- Plan Moments: one reflection per person per plan.
-- Documentation-only. Applied directly in production Supabase on 2026-04-06.

-- 1. plan_moments table
CREATE TABLE IF NOT EXISTS plan_moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_public boolean NOT NULL DEFAULT false,
  UNIQUE (event_id, user_id)
);

ALTER TABLE plan_moments ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_plan_moments_event ON plan_moments (event_id);
CREATE INDEX idx_plan_moments_user ON plan_moments (user_id);

-- SELECT: active event members who aren't no-shows
CREATE POLICY "Event members can view moments if not no-show"
  ON plan_moments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM event_members em
      WHERE em.event_id = plan_moments.event_id
        AND em.user_id = auth.uid()
        AND em.status = 'joined'
    )
    AND NOT EXISTS (
      SELECT 1 FROM plan_attendance pa
      WHERE pa.event_id = plan_moments.event_id
        AND pa.user_id = auth.uid()
        AND pa.was_present = false
    )
  );

-- INSERT: users can only insert their own moment
CREATE POLICY "Users can insert own moments"
  ON plan_moments FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM event_members em
      WHERE em.event_id = plan_moments.event_id
        AND em.user_id = auth.uid()
        AND em.status = 'joined'
    )
  );

-- UPDATE: users can only update their own moment
CREATE POLICY "Users can update own moments"
  ON plan_moments FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- DELETE: users can only delete their own moment
CREATE POLICY "Users can delete own moments"
  ON plan_moments FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 2. RPC: get_user_moments
CREATE OR REPLACE FUNCTION get_user_moments(p_user_id uuid)
RETURNS TABLE(
  moment_id uuid,
  event_id uuid,
  user_id uuid,
  content text,
  created_at timestamptz,
  is_public boolean,
  writer_name text,
  writer_photo text,
  plan_title text,
  plan_date timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pm.id AS moment_id,
    pm.event_id,
    pm.user_id,
    pm.content,
    pm.created_at,
    pm.is_public,
    p.first_name_display AS writer_name,
    p.profile_photo_url AS writer_photo,
    e.title AS plan_title,
    e.start_time AS plan_date
  FROM plan_moments pm
  JOIN events e ON e.id = pm.event_id
  JOIN profiles p ON p.id = pm.user_id
  -- User must be an active member of the event
  JOIN event_members em ON em.event_id = pm.event_id
    AND em.user_id = p_user_id
    AND em.status = 'joined'
  -- User must not be marked as no-show
  WHERE NOT EXISTS (
    SELECT 1 FROM plan_attendance pa
    WHERE pa.event_id = pm.event_id
      AND pa.user_id = p_user_id
      AND pa.was_present = false
  )
  ORDER BY pm.created_at DESC;
END;
$$;
