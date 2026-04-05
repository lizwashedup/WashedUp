-- Documentation-only migration. These tables were created directly in production
-- Supabase on 2026-04-04. This file exists so the schema is tracked in the repo.

-- Plan feedback: collected via post-plan survey after a completed event
CREATE TABLE IF NOT EXISTS plan_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attended boolean NOT NULL,
  rating text CHECK (rating IN ('thumbs_up', 'thumbs_down')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

-- No-show reports: one row per reported member, per reporter, per event
CREATE TABLE IF NOT EXISTS no_show_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reporter_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  no_show_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, reporter_user_id, no_show_user_id)
);

-- RLS policies (permissive — users can insert their own feedback/reports)
ALTER TABLE plan_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE no_show_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own feedback"
  ON plan_feedback FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own feedback"
  ON plan_feedback FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own no-show reports"
  ON no_show_reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_user_id);
