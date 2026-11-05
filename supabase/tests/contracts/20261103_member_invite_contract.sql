CREATE FUNCTION pg_temp.check_true(ok boolean, label text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RETURN 'PASS: '||label; END $$;
CREATE FUNCTION pg_temp.denied(statement text, expected text, label text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE expected THEN RAISE EXCEPTION 'FAIL: %, unexpected refusal: %',label,SQLERRM; END IF;
  RETURN 'PASS: '||label;
 END;
 RAISE EXCEPTION 'FAIL: %, write was allowed',label;
END $$;
BEGIN;
SELECT fixture_invite('00000000-0000-0000-0000-000000000002','valid');
SELECT pg_temp.check_true((SELECT status='viewed' FROM preview_member_invite('valid')), 'opening a fresh link returns viewed, not pending');
SELECT pg_temp.check_true((SELECT count(*)=0 FROM community_members), 'preview never grants membership');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
SELECT pg_temp.denied($s$SELECT accept_member_invite('valid')$s$,'this invite is not for you','forwarded link rejects another account');
SELECT pg_temp.check_true((SELECT status='viewed' FROM community_member_invites), 'wrong-account failure does not consume the invitation');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SELECT accept_member_invite('valid');
SELECT pg_temp.check_true((SELECT status='active' AND role='member' FROM community_members), 'matching audience joins');
SELECT pg_temp.check_true((SELECT status='accepted' AND accepted_by_user_id=auth.uid() FROM community_member_invites), 'acceptance belongs to the authenticated recipient');
SELECT pg_temp.denied($s$SELECT accept_member_invite('valid')$s$,'this invite is no longer available','accepted token cannot be reused');
ROLLBACK;

BEGIN;
SELECT fixture_invite('00000000-0000-0000-0000-000000000003','wrong-audience');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
SELECT pg_temp.denied($s$SELECT accept_member_invite('wrong-audience')$s$,'Community unavailable','publication audience rejects a nonmatching recipient');
SELECT pg_temp.check_true((SELECT count(*)=0 FROM community_members), 'failed audience check creates no membership');
SELECT pg_temp.check_true((SELECT status='pending' FROM community_member_invites), 'failed audience check does not consume the invitation');
ROLLBACK;

BEGIN;
SELECT fixture_invite('00000000-0000-0000-0000-000000000004','missing-gender');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
SELECT pg_temp.denied($s$SELECT accept_member_invite('missing-gender')$s$,'Community unavailable','missing profile gender fails the restricted audience check');
ROLLBACK;

BEGIN;
INSERT INTO community_members VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','member','banned','2025-01-01');
SELECT fixture_invite('00000000-0000-0000-0000-000000000002','banned');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SELECT pg_temp.denied($s$SELECT accept_member_invite('banned')$s$,'cannot accept: banned from this community','invitation cannot override a ban');
SELECT pg_temp.check_true((SELECT status='banned' FROM community_members), 'ban remains intact');
ROLLBACK;

BEGIN;
SELECT fixture_invite('00000000-0000-0000-0000-000000000002','expired');
UPDATE community_member_invites SET expires_at=now();
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SELECT pg_temp.check_true((SELECT status='expired' FROM preview_member_invite('expired')), 'preview renders expiration even before storage is updated');
SELECT pg_temp.denied($s$SELECT accept_member_invite('expired')$s$,'this invite has expired','expiry boundary rejects acceptance');
SELECT pg_temp.check_true((SELECT count(*)=0 FROM community_members), 'expired link grants no membership');
ROLLBACK;

BEGIN;
SELECT fixture_invite('00000000-0000-0000-0000-000000000002','revoked');
UPDATE community_member_invites SET status='revoked';
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SELECT pg_temp.denied($s$SELECT accept_member_invite('revoked')$s$,'this invite is no longer available','replacement or cancellation invalidates the old token');
ROLLBACK;

BEGIN;
INSERT INTO community_members VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','co_leader','inactive','2025-01-01');
SELECT fixture_invite('00000000-0000-0000-0000-000000000002','returning');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SELECT accept_member_invite('returning');
SELECT pg_temp.check_true((SELECT status='active' AND role='co_leader' AND joined_at='2025-01-01'::timestamptz FROM community_members), 'returning member retains original role and joined date');
ROLLBACK;

BEGIN;
UPDATE creator_page_publications SET audience='nonbinary_only';
SELECT fixture_invite('00000000-0000-0000-0000-000000000005','nb');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000005';
SELECT accept_member_invite('nb');
SELECT pg_temp.check_true((SELECT status='active' FROM community_members), 'nonbinary publication audience accepts matching profile');
ROLLBACK;

-- Characterizations of missing guards, NOT claims that these outcomes are desired.
BEGIN;
DELETE FROM creator_page_publications;
SELECT fixture_invite('00000000-0000-0000-0000-000000000003','legacy');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
SELECT accept_member_invite('legacy');
SELECT pg_temp.check_true((SELECT status='active' FROM community_members), 'GAP reproduced: absent publication means no audience check');
ROLLBACK;

-- Archived-community baseline gap.
BEGIN;
UPDATE communities SET status='archived';
SELECT fixture_invite('00000000-0000-0000-0000-000000000002','archived');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SELECT accept_member_invite('archived');
SELECT pg_temp.check_true((SELECT status='active' FROM community_members), 'GAP reproduced: archived community can still accept an outstanding invitation');
ROLLBACK;
