\set ON_ERROR_STOP on

-- AC-MSG-002 (half that needs no phone): a caption-less photo message must
-- still push a NONBLANK notification body naming what happened, to a real
-- topic member, carrying the topic id the client tap router needs -- never
-- a blank push, and never a push to a community member who never joined
-- this room. AC-MSG-001/003 (half that needs no phone): once a message
-- lands, another member -- not just the sender -- can actually read it
-- server-side, independent of any client render.

SET ROLE authenticated;
SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
SET request.jwt.claim.role = 'authenticated';

INSERT INTO public.community_topic_messages(id, topic_id, sender_id, image_url, body)
VALUES (
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'https://example.test/photo.jpg',
  ''
);

RESET ROLE;

DO $$
DECLARE
  v_body text;
  v_topic_id uuid;
  v_row_count int;
BEGIN
  SELECT count(*) INTO v_row_count
  FROM public.app_notifications
  WHERE user_id = '10000000-0000-0000-0000-000000000002' AND type = 'new_message';
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'contract failed: expected exactly one push to the real topic member, got %', v_row_count;
  END IF;

  SELECT body, topic_id INTO v_body, v_topic_id
  FROM public.app_notifications
  WHERE user_id = '10000000-0000-0000-0000-000000000002' AND type = 'new_message';

  IF v_body IS NULL OR btrim(v_body) = '' THEN
    RAISE EXCEPTION 'contract failed: a caption-less photo message pushed a blank notification body';
  END IF;
  IF v_body !~ 'sent a photo' THEN
    RAISE EXCEPTION 'contract failed: photo-only notification body does not name what happened (got: %)', v_body;
  END IF;
  IF v_topic_id IS DISTINCT FROM '30000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'contract failed: notification does not carry the topic id the client tap router needs';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.app_notifications
    WHERE user_id = '10000000-0000-0000-0000-000000000003'
  ) THEN
    RAISE EXCEPTION 'contract failed: a community member who never joined this room was pushed a room notification';
  END IF;
END $$;

-- Another member -- deliberately the one who never separately joined the
-- topic, only the community -- can read the message the instant it lands.
-- This is the server-side half of "another member receives and sees it";
-- rendering it on a real screen is the device half AC-REL-004 still owns.
SET ROLE authenticated;
SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
SET request.jwt.claim.role = 'authenticated';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.community_topic_messages
    WHERE id = '40000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'contract failed: an ordinary community member could not read a topic message in their own community';
  END IF;
END $$;

RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'PASS: threshold 75 topic-notification body and cross-member read contracts'; END $$;
