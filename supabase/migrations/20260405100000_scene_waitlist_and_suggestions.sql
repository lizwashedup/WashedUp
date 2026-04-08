-- Scene page: waitlist for notifications and community suggestions
-- Documentation-only — apply directly in production Supabase.

CREATE TABLE IF NOT EXISTS scene_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS scene_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  suggestion text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scene_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE scene_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own waitlist" ON scene_waitlist FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Authenticated users can count waitlist" ON scene_waitlist FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert own suggestions" ON scene_suggestions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
