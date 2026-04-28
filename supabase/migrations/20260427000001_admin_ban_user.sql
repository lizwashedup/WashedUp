-- Adds the moderation_actions audit log + admin_ban_user() function so that
-- a single SQL call atomically: bans the auth record, snapshots identifiers
-- into banned_identifiers, wipes the user's data (keeping reports as evidence),
-- and logs the action.

CREATE TABLE IF NOT EXISTS public.moderation_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action          text NOT NULL,
  target_user_id  uuid,
  target_email    text,
  target_apple_sub text,
  reason          text NOT NULL,
  performed_by    uuid REFERENCES auth.users(id),
  performed_at    timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS moderation_actions_target_idx
  ON moderation_actions (target_user_id);
CREATE INDEX IF NOT EXISTS moderation_actions_performed_at_idx
  ON moderation_actions (performed_at DESC);

ALTER TABLE moderation_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS moderation_actions_admin_read ON moderation_actions;
CREATE POLICY moderation_actions_admin_read ON moderation_actions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.admin_ban_user(
  target_id uuid,
  ban_reason text,
  photo_hash_override text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  caller_id        uuid;
  target_email     text;
  target_apple_sub text;
  target_photo_url text;
BEGIN
  caller_id := auth.uid();

  IF caller_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM admin_users WHERE user_id = caller_id
  ) THEN
    RAISE EXCEPTION 'forbidden: admin only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT u.email, u.raw_user_meta_data->>'sub'
    INTO target_email, target_apple_sub
  FROM auth.users u WHERE u.id = target_id;

  IF target_email IS NULL AND target_apple_sub IS NULL THEN
    RAISE EXCEPTION 'user not found: %', target_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT profile_photo_url INTO target_photo_url
  FROM profiles WHERE id = target_id;

  INSERT INTO banned_identifiers
    (email, apple_sub, photo_hash, reason, banned_by, banned_at)
  VALUES
    (target_email, target_apple_sub, photo_hash_override, ban_reason, caller_id, now());

  UPDATE auth.users
     SET banned_until = '9999-12-31 23:59:59+00'
   WHERE id = target_id;

  DELETE FROM messages       WHERE user_id = target_id;
  DELETE FROM event_members  WHERE user_id = target_id;
  DELETE FROM chat_reads     WHERE user_id = target_id;
  DELETE FROM friends        WHERE user_id = target_id OR friend_id = target_id;
  DELETE FROM events         WHERE creator_user_id = target_id;
  DELETE FROM profiles       WHERE id = target_id;

  INSERT INTO moderation_actions
    (action, target_user_id, target_email, target_apple_sub, reason, performed_by, metadata)
  VALUES
    ('ban', target_id, target_email, target_apple_sub, ban_reason, caller_id,
     jsonb_build_object('photo_url', target_photo_url, 'photo_hash', photo_hash_override));

  RETURN jsonb_build_object(
    'success', true,
    'banned_user_id', target_id,
    'banned_email', target_email,
    'banned_apple_sub', target_apple_sub,
    'photo_hash_recorded', photo_hash_override IS NOT NULL
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_ban_user(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_ban_user(uuid, text, text) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='moderation_actions')
  THEN RAISE EXCEPTION 'TEST FAIL: moderation_actions not created'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc
                 WHERE proname='admin_ban_user' AND pronamespace='public'::regnamespace)
  THEN RAISE EXCEPTION 'TEST FAIL: admin_ban_user fn not created'; END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE relname='moderation_actions' AND relnamespace='public'::regnamespace)
  THEN RAISE EXCEPTION 'TEST FAIL: RLS not enabled on moderation_actions'; END IF;

  RAISE NOTICE 'admin_ban_user migration tests passed';
END $$;
