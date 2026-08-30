-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
--
-- Closes the gap flagged in 20260825110100_harden_admin_delete_gate_and_reports_fks.sql:
-- admin_ban_user() is the ONLY one of the app's three user-delete paths that
-- does not clean up `reports` before deleting the profile. Both
-- admin_cascade_delete_user() and delete_own_account() already run
--   DELETE FROM reports WHERE reporter_user_id = ... OR reported_user_id = ...
-- before their profile delete. That missing line is (a) the root cause of the
-- 14 orphaned reports.reported_user_id rows counted live on 2026-08-25, and
-- (b) the reason the reports.reporter_user_id FK -- the last of the reports
-- FKs -- could not be added: with the gap open, the next admin-ban of anyone
-- who had ever FILED a report would throw an unhandled FK violation and fail
-- the whole ban.
--
-- This migration does exactly two things:
--   1. Re-creates admin_ban_user() with the one missing cleanup line, placed
--      in the same position the other two delete paths use (after friends,
--      before events/profile). Every other line of the function body is
--      byte-identical to the live definition captured in
--      ops/drift/baseline-20260825.sql (2026-08-25 17:09 dump).
--   2. Adds the reporter_user_id FK (NOT VALID then VALIDATE -- 0 orphans
--      existed at the 2026-08-25 count; if one appeared since, VALIDATE
--      aborts the transaction cleanly and nothing is half-applied).
--
-- Deliberately NOT touched, same as the 8/25 migration:
--   - reports.reported_user_id FK: 14 known orphans need a data decision
--     (null out vs backfill vs delete) before any FK can be added.
--   - reports.reported_event_id FK: 5 known orphans, same reasoning.
--   - The moderation policy itself (who gets banned, thresholds, evidence
--     snapshot shape): only the reports cleanup line is new.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_ban_user(target_id uuid, ban_reason text, photo_hash_override text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  caller_id        uuid;
  target_email     text;
  target_phone     text;
  target_apple_sub text;
  profile_email    text;
  target_photo_url text;
  v_msgs           jsonb;
  v_dm_circles     uuid[];
BEGIN
  caller_id := auth.uid();

  IF caller_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM admin_users WHERE user_id = caller_id
  ) THEN
    RAISE EXCEPTION 'forbidden: admin only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT u.email, u.phone::text, u.raw_user_meta_data->>'sub'
    INTO target_email, target_phone, target_apple_sub
  FROM auth.users u WHERE u.id = target_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found: %', target_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT p.profile_photo_url, p.email
    INTO target_photo_url, profile_email
  FROM profiles p WHERE p.id = target_id;

  -- Phone-auth users have no auth.users.email; the onboarding email lives on
  -- the profile. Ban whichever identifiers exist.
  target_email := COALESCE(target_email, profile_email);

  IF target_email IS NULL AND target_apple_sub IS NULL AND target_phone IS NULL THEN
    RAISE EXCEPTION 'no bannable identifier for user: %', target_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- normalized_email is filled by the banned_identifiers_normalize trigger.
  INSERT INTO banned_identifiers
    (email, apple_sub, phone_number, photo_hash, reason, banned_by, banned_at)
  VALUES
    (target_email, target_apple_sub, target_phone, photo_hash_override, ban_reason, caller_id, now());

  UPDATE auth.users
     SET banned_until = '9999-12-31 23:59:59+00'
   WHERE id = target_id;

  -- banned_until only blocks token refresh; kill any live session now.
  DELETE FROM auth.refresh_tokens WHERE user_id = target_id::text;
  DELETE FROM auth.sessions       WHERE user_id = target_id;

  -- Evidence snapshot before the content deletes.
  SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO v_msgs
  FROM messages m WHERE m.user_id = target_id;

  -- Capture 1:1 DM shells now: the profile delete cascades circle_members,
  -- after which the user's DMs can no longer be identified.
  SELECT coalesce(array_agg(DISTINCT cm.circle_id), '{}') INTO v_dm_circles
  FROM circle_members cm JOIN circles c ON c.id = cm.circle_id
  WHERE cm.user_id = target_id AND c.name = '';

  DELETE FROM messages       WHERE user_id = target_id;
  DELETE FROM event_members  WHERE user_id = target_id;
  DELETE FROM chat_reads     WHERE user_id = target_id;
  DELETE FROM friends        WHERE user_id = target_id OR friend_id = target_id;
  -- Reports naming the banned user (either side) go before the profile
  -- delete, mirroring admin_cascade_delete_user() / delete_own_account().
  -- This is the line whose absence orphaned 14 reported_user_id rows and
  -- blocked the reporter_user_id FK below (added 2026-08-26).
  DELETE FROM reports        WHERE reporter_user_id = target_id OR reported_user_id = target_id;
  DELETE FROM events         WHERE creator_user_id = target_id;
  DELETE FROM profiles       WHERE id = target_id;

  -- Sweep DM shells that now hold no messages at all, so the counterpart
  -- doesn't keep a blank ghost thread. DMs where the other person wrote
  -- messages are kept.
  DELETE FROM circle_members cm
  WHERE cm.circle_id = ANY (v_dm_circles)
    AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.circle_id = cm.circle_id);
  DELETE FROM circles c
  WHERE c.id = ANY (v_dm_circles)
    AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.circle_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM circle_members m WHERE m.circle_id = c.id);

  INSERT INTO moderation_actions
    (action, target_user_id, target_email, target_apple_sub, reason, performed_by, metadata)
  VALUES
    ('ban', target_id, target_email, target_apple_sub, ban_reason, caller_id,
     jsonb_build_object(
       'photo_url', target_photo_url,
       'photo_hash', photo_hash_override,
       'phone_number', target_phone,
       'deleted_message_snapshot', v_msgs,
       'dm_shells_removed', to_jsonb(v_dm_circles)));

  RETURN jsonb_build_object(
    'success', true,
    'banned_user_id', target_id,
    'banned_email', target_email,
    'banned_phone', target_phone,
    'banned_apple_sub', target_apple_sub,
    'photo_hash_recorded', photo_hash_override IS NOT NULL
  );
END $$;

-- The last reports FK, previously blocked on the cleanup above. reporter_user_id
-- is NOT NULL, so ON DELETE options that null it are unavailable by design:
-- plain (NO ACTION) enforcement is the point -- every delete path now cleans
-- reports first, and any future path that forgets will fail loudly here
-- instead of silently minting orphans.
ALTER TABLE public.reports
  ADD CONSTRAINT reports_reporter_user_id_fkey
  FOREIGN KEY (reporter_user_id) REFERENCES public.profiles(id)
  NOT VALID;

ALTER TABLE public.reports VALIDATE CONSTRAINT reports_reporter_user_id_fkey;

DO $$
BEGIN
  IF position('DELETE FROM reports' IN pg_get_functiondef('public.admin_ban_user(uuid, text, text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'admin_ban_user is missing the reports cleanup line';
  END IF;
  -- The gate and the session-kill must have survived the re-create untouched.
  IF position('SELECT 1 FROM admin_users WHERE user_id = caller_id' IN pg_get_functiondef('public.admin_ban_user(uuid, text, text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'admin_ban_user lost its admin_users gate';
  END IF;
  IF position('DELETE FROM auth.refresh_tokens' IN pg_get_functiondef('public.admin_ban_user(uuid, text, text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'admin_ban_user lost its session-kill step';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reports'::regclass AND conname = 'reports_reporter_user_id_fkey' AND convalidated) THEN
    RAISE EXCEPTION 'reports_reporter_user_id_fkey missing or not validated';
  END IF;
  -- The two data-decision FKs must still NOT exist (see header).
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reports'::regclass AND conname = 'reports_reported_user_id_fkey') THEN
    RAISE EXCEPTION 'reports_reported_user_id_fkey should not exist -- 14 known orphans, data decision pending';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reports'::regclass AND conname = 'reports_reported_event_id_fkey') THEN
    RAISE EXCEPTION 'reports_reported_event_id_fkey should not exist -- 5 known orphans, data decision pending';
  END IF;
END $$;

COMMIT;
