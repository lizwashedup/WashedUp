-- Waitlist Exceptions — Phase 1, Migration 1 of N: additive schema only.
--
-- Adds the columns + constraints the exception engine needs. No RPCs, no
-- triggers, no behavior change yet (those are later migrations). Everything
-- here is additive and idempotent so a re-run is safe.
--
-- Supabase preview branches are broken in this project, so this is applied
-- directly to prod. apply_migration runs in a single transaction: the
-- embedded DO-block self-test at the bottom RAISEs on any failed assertion,
-- which aborts the whole transaction and rolls back every statement here
-- (no partial apply).
--
-- Verified against prod before authoring:
--   * none of the new columns exist yet
--   * app_notifications_type_check currently allows exactly these 18 types:
--     waitlist_spot, broadcast, event_reminder, member_joined, plan_invite,
--     invite_accepted, new_message, album_ready, plan_cancelled,
--     duplicate_plan, interest_signal, interest_invite, album_upload_prompt,
--     album_upload_reminder, album_someone_uploaded, album_more_photos_added,
--     album_creator_no_uploads_nudge, album_hearts_batched
--   The recreated constraint below preserves all 18 and adds 3 new types.

-- 1. event_waitlist: per-row exception invitation state.
ALTER TABLE public.event_waitlist
  ADD COLUMN IF NOT EXISTS exception_status     text,
  ADD COLUMN IF NOT EXISTS exception_invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS exception_expires_at timestamptz;

-- NULL = a normal waitlister (no exception invite). Otherwise one of the
-- lifecycle states.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_waitlist'::regclass
      AND conname  = 'event_waitlist_exception_status_check'
  ) THEN
    ALTER TABLE public.event_waitlist
      ADD CONSTRAINT event_waitlist_exception_status_check
      CHECK (exception_status IS NULL
             OR exception_status IN ('invited','accepted','declined','expired'));
  END IF;
END $$;

-- 2. events: per-plan exception slot counter + creator-closed flag.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS exception_slots_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS waitlist_closed      boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass
      AND conname  = 'events_exception_slots_used_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_exception_slots_used_check
      CHECK (exception_slots_used >= 0 AND exception_slots_used <= 3);
  END IF;
END $$;

-- 3. event_members: mark members who joined via an exception so the creator
-- manager can still show "joined" after the existing cleanup trigger deletes
-- the event_waitlist row on join.
ALTER TABLE public.event_members
  ADD COLUMN IF NOT EXISTS joined_via_exception boolean NOT NULL DEFAULT false;

-- 4. app_notifications: extend the type CHECK to allow the 3 new types,
-- preserving every existing type exactly.
ALTER TABLE public.app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_type_check;

ALTER TABLE public.app_notifications
  ADD CONSTRAINT app_notifications_type_check CHECK (type = ANY (ARRAY[
    -- existing 18 (unchanged)
    'waitlist_spot','broadcast','event_reminder','member_joined','plan_invite',
    'invite_accepted','new_message','album_ready','plan_cancelled',
    'duplicate_plan','interest_signal','interest_invite','album_upload_prompt',
    'album_upload_reminder','album_someone_uploaded','album_more_photos_added',
    'album_creator_no_uploads_nudge','album_hearts_batched',
    -- new (Waitlist Exceptions)
    'waitlist_request','exception_invite','exception_slot_refunded'
  ]::text[]));

-- ── Embedded self-test (aborts + rolls back the whole migration on failure) ──
DO $$
DECLARE
  v_def  text;
  v_type text;
  v_required text[] := ARRAY[
    'waitlist_spot','broadcast','event_reminder','member_joined','plan_invite',
    'invite_accepted','new_message','album_ready','plan_cancelled',
    'duplicate_plan','interest_signal','interest_invite','album_upload_prompt',
    'album_upload_reminder','album_someone_uploaded','album_more_photos_added',
    'album_creator_no_uploads_nudge','album_hearts_batched',
    'waitlist_request','exception_invite','exception_slot_refunded'
  ];
BEGIN
  -- 4a. new columns exist with correct nullability/defaults
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='event_waitlist'
      AND column_name='exception_status' AND data_type='text') THEN
    RAISE EXCEPTION 'self-test: event_waitlist.exception_status missing/wrong type';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='event_waitlist'
      AND column_name='exception_invited_at' AND data_type='timestamp with time zone') THEN
    RAISE EXCEPTION 'self-test: event_waitlist.exception_invited_at missing/wrong type';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='event_waitlist'
      AND column_name='exception_expires_at' AND data_type='timestamp with time zone') THEN
    RAISE EXCEPTION 'self-test: event_waitlist.exception_expires_at missing/wrong type';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='events'
      AND column_name='exception_slots_used' AND data_type='integer'
      AND is_nullable='NO' AND column_default='0') THEN
    RAISE EXCEPTION 'self-test: events.exception_slots_used missing/wrong (need int NOT NULL DEFAULT 0)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='events'
      AND column_name='waitlist_closed' AND data_type='boolean'
      AND is_nullable='NO' AND column_default='false') THEN
    RAISE EXCEPTION 'self-test: events.waitlist_closed missing/wrong (need bool NOT NULL DEFAULT false)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='event_members'
      AND column_name='joined_via_exception' AND data_type='boolean'
      AND is_nullable='NO' AND column_default='false') THEN
    RAISE EXCEPTION 'self-test: event_members.joined_via_exception missing/wrong (need bool NOT NULL DEFAULT false)';
  END IF;

  -- 4b. exception_status CHECK present
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='public.event_waitlist'::regclass
      AND conname='event_waitlist_exception_status_check') THEN
    RAISE EXCEPTION 'self-test: event_waitlist_exception_status_check missing';
  END IF;

  -- 4c. exception_slots_used CHECK present
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='public.events'::regclass
      AND conname='events_exception_slots_used_check') THEN
    RAISE EXCEPTION 'self-test: events_exception_slots_used_check missing';
  END IF;

  -- 4d. app_notifications type CHECK still allows EVERY required type
  -- (all 18 originals preserved + the 3 new ones).
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid='public.app_notifications'::regclass
    AND conname='app_notifications_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'self-test: app_notifications_type_check missing';
  END IF;
  FOREACH v_type IN ARRAY v_required LOOP
    IF position('''' || v_type || '''' IN v_def) = 0 THEN
      RAISE EXCEPTION 'self-test: app_notifications_type_check missing type %', v_type;
    END IF;
  END LOOP;

  RAISE NOTICE 'waitlist_exceptions_schema self-test passed';
END $$;
