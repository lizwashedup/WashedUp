SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SELECT fixture_assert((get_community_joining_options(null)->>'version')::int=1,'creation capability is explicit');
SELECT fixture_assert(get_community_joining_options('10000000-0000-0000-0000-000000000001')->>'method'='approval_required','old raw Open remains Review requests');
SELECT fixture_assert(get_community_joining_options('10000000-0000-0000-0000-000000000002')->>'method'='open','published Open remains Open');
SELECT fixture_assert((SELECT count(*)=0 FROM community_joining_choices),'upgrade invents no creator choices');
SELECT fixture_assert((SELECT count(*)=1 FROM community_members WHERE community_id='10000000-0000-0000-0000-000000000001' AND status='pending'),'upgrade preserves the existing pending request');
SELECT set_community_join_policy('10000000-0000-0000-0000-000000000001','open');
SELECT fixture_assert(get_community_joining_options('10000000-0000-0000-0000-000000000001')->>'method'='open','explicit Open enables automatic admission');
SELECT fixture_assert((SELECT creator_page_join_settings_version=1 FROM communities WHERE id='10000000-0000-0000-0000-000000000001'),'effective joining change advances the settings version');
SELECT fixture_assert((SELECT count(*)=1 FROM community_members WHERE community_id='10000000-0000-0000-0000-000000000001' AND status='pending'),'changing method does not approve old requests');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
SELECT request_to_join_community('10000000-0000-0000-0000-000000000001',fixture_answers());
SELECT fixture_assert((SELECT status='active' FROM community_members WHERE user_id=auth.uid() AND community_id='10000000-0000-0000-0000-000000000001'),'new legacy Open request uses actual finalizer');
SELECT fixture_assert((SELECT count(*)=1 FROM community_broadcasts WHERE sender_id=auth.uid()),'existing introduction path runs once');
SELECT fixture_assert((SELECT count(*)=1 FROM app_notifications WHERE user_id=auth.uid() AND type='community_join_approved'),'existing approval notice is retained');
DO $$BEGIN
 BEGIN PERFORM set_community_join_policy('10000000-0000-0000-0000-000000000001','approval_required'); RAISE EXCEPTION 'Unauthorized setter passed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Not the leader of this community' THEN RAISE; END IF; END;
 BEGIN PERFORM request_to_join_community('10000000-0000-0000-0000-000000000002',fixture_answers()); RAISE EXCEPTION 'Audience bypass'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'That community is not open to joins right now.' THEN RAISE; END IF; END;
 BEGIN PERFORM create_community_with_joining(gen_random_uuid(),'not-allowed','Not allowed','LA','Testing a community','open'); RAISE EXCEPTION 'Grant bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END$$;
SELECT fixture_assert(NOT EXISTS(SELECT 1 FROM community_members WHERE user_id=auth.uid() AND community_id='10000000-0000-0000-0000-000000000002'),'published audience still rejects membership');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SELECT set_community_join_policy('10000000-0000-0000-0000-000000000001','approval_required');
SELECT fixture_assert(get_community_joining_options('10000000-0000-0000-0000-000000000001')->>'method'='approval_required','creator can change the method later');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
SELECT request_to_join_community('10000000-0000-0000-0000-000000000001',fixture_answers());
SELECT fixture_assert((SELECT status='pending' FROM community_members WHERE user_id=auth.uid() AND community_id='10000000-0000-0000-0000-000000000001'),'Review requests keeps a new join pending');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SELECT fixture_assert((SELECT role='leader' AND joined_at='2025-01-01' FROM community_members WHERE user_id=auth.uid() AND community_id='10000000-0000-0000-0000-000000000001'),'existing creator role and joined date preserved');
DO $$DECLARE first_id uuid; second_id uuid; review_id uuid; BEGIN
 first_id:=create_community_with_joining('20000000-0000-0000-0000-000000000001','new-open','New Open','LA','Keep meeting for walks','open');
 second_id:=create_community_with_joining('20000000-0000-0000-0000-000000000001','new-open','New Open','LA','Keep meeting for walks','open');
 PERFORM fixture_assert(first_id=second_id,'same create request returns the same community');
 PERFORM fixture_assert((SELECT status='draft' FROM communities WHERE id=first_id),'creation stays private draft');
 PERFORM fixture_assert((SELECT count(*)=5 FROM community_blocks WHERE community_id=first_id),'retry does not duplicate starter blocks');
 PERFORM fixture_assert((SELECT count(*)=1 FROM community_members WHERE community_id=first_id),'retry does not duplicate creator membership');
 PERFORM fixture_assert((get_community_creation_attempt('20000000-0000-0000-0000-000000000001')->>'community_id')::uuid=first_id,'read-only recovery returns the saved receipt');
 PERFORM fixture_assert(get_community_joining_options(first_id)->>'method'='open','initial Open choice is saved');
 review_id:=create_community_with_joining('20000000-0000-0000-0000-000000000002','new-review','New Review','LA','Keep meeting for coffee','approval_required');
 PERFORM fixture_assert(get_community_joining_options(review_id)->>'method'='approval_required','initial Review choice is saved');
 BEGIN PERFORM create_community_with_joining('20000000-0000-0000-0000-000000000001','changed','Changed','LA','Keep meeting for walks','open'); RAISE EXCEPTION 'Changed payload passed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM create_community_with_joining(gen_random_uuid(),'missing-choice','Missing Choice','LA','Keep meeting for walks',null); RAISE EXCEPTION 'Missing choice passed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM set_community_join_policy(first_id,null); RAISE EXCEPTION 'Null setter passed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Unknown join policy%' THEN RAISE; END IF; END;
END$$;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
SELECT fixture_assert(get_community_creation_attempt('20000000-0000-0000-0000-000000000001') IS NULL,'creation receipt never crosses accounts');
SELECT fixture_assert(NOT has_table_privilege('authenticated','community_joining_choices','INSERT'),'clients cannot forge explicit choices');
SELECT fixture_assert(NOT has_table_privilege('authenticated','community_creation_attempts','SELECT'),'clients cannot list creation payloads');
SELECT fixture_assert(NOT has_function_privilege('anon','create_community_with_joining(uuid,text,text,text,text,text)','EXECUTE'),'anonymous creation denied');
SELECT fixture_assert(NOT has_function_privilege('authenticated','community_joining_is_open(uuid)','EXECUTE'),'internal admission helper is not exposed');
-- Rejected creation is atomic, with no abandoned receipt or partial page.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
DO $$BEGIN
 BEGIN PERFORM create_community_with_joining('20000000-0000-0000-0000-000000000003','legacy','Duplicate','LA','Testing a duplicate handle','open'); RAISE EXCEPTION 'Duplicate accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 PERFORM fixture_assert(get_community_creation_attempt('20000000-0000-0000-0000-000000000003') IS NULL,'rejected create rolls back its private receipt');
 -- Legacy clients still use their unchanged RPC, and keep approval semantics.
 PERFORM create_community('older-client','Older Client',null,'LA','Older client details');
 PERFORM fixture_assert(get_community_joining_options((SELECT id FROM communities WHERE handle='older-client'))->>'method'='approval_required','older clients cannot accidentally opt into Open');
END$$;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000005';
DO $$BEGIN
 BEGIN PERFORM request_to_join_community('10000000-0000-0000-0000-000000000002',fixture_answers()); RAISE EXCEPTION 'Unknown gender admitted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'That community is not open to joins right now.' THEN RAISE; END IF; END;
 BEGIN PERFORM request_to_join_community('10000000-0000-0000-0000-000000000003',fixture_answers()); RAISE EXCEPTION 'Archived admitted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'That community is not open to joins right now.' THEN RAISE; END IF; END;
END$$;
-- Bans and existing answers survive an explicit Open change.
INSERT INTO community_members(community_id,user_id,role,status) VALUES('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006','member','banned');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SELECT set_community_join_policy('10000000-0000-0000-0000-000000000001','open');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
DO $$BEGIN
 BEGIN PERFORM request_to_join_community('10000000-0000-0000-0000-000000000001',fixture_answers()); RAISE EXCEPTION 'Banned admitted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Banned admitted' THEN RAISE; END IF; END;
 PERFORM fixture_assert((SELECT status='banned' FROM community_members WHERE user_id=auth.uid() AND community_id='10000000-0000-0000-0000-000000000001'),'Open never overrides a ban');
END$$;
-- The new private records must not add blockers to profile cleanup.
INSERT INTO profiles VALUES('00000000-0000-0000-0000-000000000009','woman',false);
INSERT INTO community_joining_choices(community_id,method,chosen_by) VALUES('10000000-0000-0000-0000-000000000003','approval_required','00000000-0000-0000-0000-000000000009');
INSERT INTO community_creation_attempts(user_id,request_id,payload) VALUES('00000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000099','{}');
DELETE FROM profiles WHERE id='00000000-0000-0000-0000-000000000009';
SELECT fixture_assert((SELECT method='approval_required' AND chosen_by IS NULL FROM community_joining_choices WHERE community_id='10000000-0000-0000-0000-000000000003'),'profile cleanup preserves the chosen admission method without personal provenance');
SELECT fixture_assert(NOT EXISTS(SELECT 1 FROM community_creation_attempts WHERE user_id='00000000-0000-0000-0000-000000000009'),'profile cleanup removes private creation payloads');
