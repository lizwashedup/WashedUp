CREATE OR REPLACE FUNCTION pg_temp.check_true(ok boolean, label text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RETURN 'PASS: '||label; END $$;
CREATE OR REPLACE FUNCTION pg_temp.denied(statement text, expected text, label text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE expected THEN RAISE EXCEPTION 'FAIL: %, unexpected refusal: %',label,SQLERRM; END IF;
  RETURN 'PASS: '||label;
 END;
 RAISE EXCEPTION 'FAIL: %, write was allowed',label;
END $$;
BEGIN;
SELECT fixture_invite('00000000-0000-0000-0000-000000000002','archived');
UPDATE communities SET status='archived';
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SELECT pg_temp.denied($s$SELECT accept_member_invite('archived')$s$,'Community unavailable','archived community rejects outstanding invitation');
SELECT pg_temp.check_true((SELECT count(*)=0 FROM community_members), 'rejection creates no membership');
SELECT pg_temp.check_true((SELECT status='pending' FROM community_member_invites), 'rejection preserves invitation history');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
SELECT pg_temp.denied($s$SELECT accept_member_invite('archived')$s$,'this invite is not for you','recipient binding remains before archive check');
ROLLBACK;
BEGIN;
UPDATE communities SET status='draft';
SELECT fixture_invite('00000000-0000-0000-0000-000000000002','draft');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SELECT accept_member_invite('draft');
SELECT pg_temp.check_true((SELECT status='active' FROM community_members), 'existing prepublication invitation behavior preserved');
ROLLBACK;
