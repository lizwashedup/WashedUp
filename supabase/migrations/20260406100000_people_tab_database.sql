-- Documentation-only. Applied directly in production Supabase on 2026-04-06.
-- Database setup for the People tab redesign.

-- 1. pinned_people table — lets users pin their closest friends to the top
CREATE TABLE IF NOT EXISTS pinned_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  pinned_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  pin_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, pinned_user_id)
);
ALTER TABLE pinned_people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own pins" ON pinned_people FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own pins" ON pinned_people FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own pins" ON pinned_people FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own pins" ON pinned_people FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 2. get_people_with_plan_history RPC
-- Returns friends with: shared plan count, most recent completed plan, activity categories
-- Sorted by shared plan count descending
-- (See function body in production)

-- 3. get_pending_invites RPC
-- Returns pending plan invites from friends
-- Includes inviter info, plan details, member counts
-- Only shows invites for active future plans
-- (See function body in production)
