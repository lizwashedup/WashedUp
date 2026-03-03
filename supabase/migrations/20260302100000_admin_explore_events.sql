-- Admin: allow designated users to update explore_events.ticket_price
-- 1. Create admin_users table (insert your user ID via Supabase dashboard)
-- 2. RPC that checks admin and updates

CREATE TABLE IF NOT EXISTS admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);

-- RLS: only admins can read (for the RPC check)
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_users_select_own"
  ON admin_users FOR SELECT
  USING (auth.uid() = user_id);

-- RPC: update explore_events.ticket_price (admin only)
CREATE OR REPLACE FUNCTION update_explore_event_ticket_price(p_event_id uuid, p_ticket_price text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to update explore events';
  END IF;
  UPDATE explore_events
  SET ticket_price = NULLIF(TRIM(p_ticket_price), '')
  WHERE id = p_event_id;
END;
$$;
