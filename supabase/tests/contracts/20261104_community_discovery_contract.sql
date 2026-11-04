SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SELECT public.fixture_assert((public.get_community_visibility_options('10000000-0000-0000-0000-000000000001')->>'can_change_discovery')::boolean,'creator capability available');
SELECT public.fixture_assert(public.set_community_discoverable('10000000-0000-0000-0000-000000000001','active',true,false) = '{"id":"10000000-0000-0000-0000-000000000001","status":"active","discoverable":false}'::jsonb,'leader changes discovery with exact receipt');
DO $$ BEGIN
 BEGIN PERFORM public.set_community_discoverable('10000000-0000-0000-0000-000000000001','active',true,true); RAISE EXCEPTION 'stale choice accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN PERFORM public.set_community_discoverable('10000000-0000-0000-0000-000000000001','active',false,NULL); RAISE EXCEPTION 'null accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN PERFORM public.set_community_discoverable('10000000-0000-0000-0000-000000000003','active',true,false); RAISE EXCEPTION 'archived accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END $$;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
DO $$ BEGIN
 BEGIN PERFORM public.get_community_visibility_options('10000000-0000-0000-0000-000000000001'); RAISE EXCEPTION 'outsider capability accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.set_community_discoverable('10000000-0000-0000-0000-000000000001','active',false,true); RAISE EXCEPTION 'outsider write accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO public.community_members(community_id,user_id,role,status) VALUES('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','co_leader','active');
SET ROLE authenticated;
SELECT public.fixture_assert((public.set_community_discoverable('10000000-0000-0000-0000-000000000001','active',false,true)->>'discoverable')::boolean,'active co-leader allowed');
RESET ROLE;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['admin','member','events','finance','member_care'] LOOP
  UPDATE public.community_members SET role=role_name WHERE user_id='00000000-0000-0000-0000-000000000002';
  BEGIN PERFORM public.set_community_discoverable('10000000-0000-0000-0000-000000000001','active',true,false); RAISE EXCEPTION 'unauthorized role accepted: %',role_name; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 UPDATE public.community_members SET role='co_leader',status='left' WHERE user_id='00000000-0000-0000-0000-000000000002';
 BEGIN PERFORM public.set_community_discoverable('10000000-0000-0000-0000-000000000001','active',true,false); RAISE EXCEPTION 'departed role accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET request.jwt.claim.sub='';
DO $$ BEGIN
 BEGIN PERFORM public.get_community_visibility_options('10000000-0000-0000-0000-000000000001'); RAISE EXCEPTION 'anonymous capability accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.set_community_discoverable('10000000-0000-0000-0000-000000000001','active',true,false); RAISE EXCEPTION 'anonymous write accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT fixture_assert(NOT has_function_privilege('anon','public.set_community_discoverable(uuid,text,boolean,boolean)','EXECUTE'),'anonymous setter unavailable');
SELECT fixture_assert(NOT has_column_privilege('authenticated','public.communities','discoverable','UPDATE'),'direct column UPDATE stays denied');
SELECT fixture_assert((SELECT join_policy='open' AND status='active' FROM communities WHERE handle='legacy'),'joining and publication unchanged');
SELECT fixture_assert((SELECT audience='women_only' FROM creator_page_publications WHERE page_id='10000000-0000-0000-0000-000000000002'),'published audience unchanged');
