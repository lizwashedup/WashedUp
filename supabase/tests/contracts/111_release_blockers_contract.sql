-- Fixed identities used only inside this disposable contract database.
INSERT INTO public.profiles(id, first_name_display) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Creator'),
  ('10000000-0000-4000-8000-000000000002', 'Member'),
  ('10000000-0000-4000-8000-000000000003', 'Blocked member'),
  ('10000000-0000-4000-8000-000000000004', 'Outsider'),
  ('10000000-0000-4000-8000-000000000005', 'Circle member');

INSERT INTO public.events(id, creator_user_id, status) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'forming');
INSERT INTO public.event_members(event_id, user_id, role, status) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'creator', 'joined'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'guest', 'joined'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'guest', 'joined');
INSERT INTO public.blocks VALUES
  ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.get_event_members_public('20000000-0000-4000-8000-000000000001')) <> 2
     OR EXISTS (
       SELECT 1 FROM public.get_event_members_public('20000000-0000-4000-8000-000000000001')
       WHERE user_id = '10000000-0000-4000-8000-000000000003'
     ) THEN
    RAISE EXCEPTION 'member-list contract: block filtering failed';
  END IF;
END $$;
RESET ROLE;

INSERT INTO public.events(id, creator_user_id, status, circle_id, circle_visibility) VALUES
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'forming',
   '30000000-0000-4000-8000-000000000001', 'circle_only');
INSERT INTO public.event_members(event_id, user_id, role, status) VALUES
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'creator', 'joined');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.get_event_members_public('20000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'member-list contract: outsider saw a private Circle plan';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

INSERT INTO public.circle_members VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', 'joined');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.get_event_members_public('20000000-0000-4000-8000-000000000002')) <> 1 THEN
    RAISE EXCEPTION 'member-list contract: Circle member lost a visible private plan';
  END IF;
END $$;
RESET ROLE;

INSERT INTO public.blocks VALUES
  ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.get_event_members_public('20000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'member-list contract: blocked creator plan remained available';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_event_members_public(uuid)', 'execute') THEN
    RAISE EXCEPTION 'member-list contract: anon can execute';
  END IF;
END $$;

-- Topic album object and registration validation.
INSERT INTO public.community_topics(id, album_enabled, archived)
VALUES ('40000000-0000-4000-8000-000000000001', true, false);
INSERT INTO public.community_topic_members VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
DO $$
BEGIN
  BEGIN
    INSERT INTO storage.objects(bucket_id, name, metadata) VALUES (
      'topic-album-media',
      '40000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002/50000000-0000-4000-8000-000000000001/original.png',
      '{"mimetype":"image/png","size":1000}'
    );
    RAISE EXCEPTION 'album contract: invalid MIME upload was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO storage.objects(bucket_id, name, metadata) VALUES (
      'topic-album-media',
      '40000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002/50000000-0000-4000-8000-000000000002/original.mp4',
      '{"mimetype":"video/mp4","size":104857601}'
    );
    RAISE EXCEPTION 'album contract: oversized upload was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO storage.objects(bucket_id, name, metadata) VALUES (
    'topic-album-media',
    '40000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002/50000000-0000-4000-8000-000000000003/original.jpg',
    '{"mimetype":"image/jpeg","size":1000}'
  );

  BEGIN
    PERFORM public.start_topic_album_upload_batch(
      '40000000-0000-4000-8000-000000000001',
      '[{"id":"50000000-0000-4000-8000-000000000003","media_url":"40000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002/50000000-0000-4000-8000-000000000003/original.jpg","content_type":"photo","media_format":"jpg","file_size_bytes":999}]'
    );
    RAISE EXCEPTION 'album contract: forged size metadata was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  PERFORM public.start_topic_album_upload_batch(
    '40000000-0000-4000-8000-000000000001',
    '[{"id":"50000000-0000-4000-8000-000000000003","media_url":"40000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002/50000000-0000-4000-8000-000000000003/original.jpg","content_type":"photo","media_format":"jpg","file_size_bytes":1000}]'
  );
END $$;
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.community_topic_album_uploads
    WHERE id = '50000000-0000-4000-8000-000000000003' AND file_size_bytes = 1000
  ) THEN
    RAISE EXCEPTION 'album contract: valid JPEG registration failed';
  END IF;
END $$;

-- Trigger behavior is proven only with disposable fixture identities.
INSERT INTO public.events(id, creator_user_id, start_time, primary_vibe) VALUES
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-08-25 21:00:00-07', 'outdoors'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '2026-08-26 21:00:00-07', 'outdoors'),
  ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '2026-08-27 21:00:00-07', 'outdoors');
INSERT INTO public.event_members(event_id, user_id, status) VALUES
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'joined'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'joined'),
  ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'joined');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_marks um JOIN public.marks m ON m.id = um.mark_id
    WHERE um.user_id = '10000000-0000-4000-8000-000000000002' AND m.slug = 'night-owl'
  ) THEN
    RAISE EXCEPTION 'identity-marks contract: trigger did not award the derived mark';
  END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
DO $$
BEGIN
  BEGIN
    PERFORM public.check_member_identity_marks('10000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'identity-marks contract: mismatched direct call succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SELECT 'release blocker contracts passed' AS result;
