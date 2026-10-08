#!/usr/bin/env python3
"""Run the review-only block boundary in an empty, Unix-socket-only PostgreSQL.
Usage: python3 scripts/db-contracts/test-private-chat-blocks.py /absolute/pg/bin
Requires existing PostgreSQL binaries; no Docker, network, credentials or installs.
Creates and removes only its own temporary database. Never accepts a DB URL.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[2]
bin_dir = Path(sys.argv[1]).resolve()
for name in ('initdb', 'pg_ctl', 'psql'):
    if not (bin_dir / name).is_file():
        raise SystemExit(f'Missing PostgreSQL executable: {name}')
# Ignore inherited connection settings; tests can connect only to this socket.
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
checks = 0
started = False
with tempfile.TemporaryDirectory(prefix='wu-blocks-', dir='/tmp') as temp:
    work = Path(temp)
    socket = work / 's'
    socket.mkdir(mode=0o700)
    data = work / 'data'
    env.update(PGHOST=str(socket), PGPORT='55478', PGDATABASE='postgres', PGUSER='block_fixture')
    def command(args):
        return subprocess.run(args, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True)
    def sql(source):
        global checks
        result = subprocess.run([str(bin_dir / 'psql'), '-X', '-v', 'ON_ERROR_STOP=1'],
            input=source, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if result.returncode:
            print(result.stdout)
            raise RuntimeError('Local SQL contract failed')
        checks += result.stdout.count('PASS:')
    assertions = """
CREATE OR REPLACE FUNCTION pg_temp.check_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE OR REPLACE FUNCTION pg_temp.denied(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: %', label; RETURN; END;
  RAISE EXCEPTION 'FAIL (write allowed): %', label;
END $$;
"""
    a = '00000000-0000-0000-0000-000000000001'
    b = '00000000-0000-0000-0000-000000000002'
    def login(viewer):
        return f"SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '{viewer}';"
    dm = '10000000-0000-0000-0000-000000000001'
    try:
        command([str(bin_dir / 'initdb'), '-D', str(data), '-U', 'block_fixture', '--auth=trust', '--no-locale'])
        command([str(bin_dir / 'pg_ctl'), '-D', str(data), '-l', str(work / 'postgres.log'),
                 '-o', f"-h '' -k {socket} -p 55478", '-w', 'start'])
        started = True
        sql((root / 'supabase/tests/contracts/20261007_private_chat_block_fixture.sql').read_text())
        source = (root / 'supabase/migrations/20260517000100_yours_helpers.sql').read_text()
        helper = re.search(r'CREATE OR REPLACE FUNCTION public.yours_is_blocked_between\(.*?\$\$;', source, re.S)
        if helper is None:
            raise RuntimeError('Canonical block helper not found')
        sql(helper.group())
        # Prove the reported server gap exists before adding the candidate.
        sql(assertions + f"""BEGIN;
UPDATE profiles SET blocked_users = ARRAY['{b}'::uuid] WHERE id = '{a}';
{login(a)}
SELECT pg_temp.check_true((SELECT count(*) FROM messages WHERE id=1)=1, 'baseline retains blocked DM');
INSERT INTO messages VALUES (10, '{dm}', null, '{a}', 'Baseline permits contact');
SELECT pg_temp.check_true((SELECT count(*) FROM messages WHERE id=10)=1, 'baseline permits blocked send');
ROLLBACK;""")
        sql((root / 'docs/database/review-only/20261007120000_private_chat_block_boundary.sql').read_text())
        for store in ('array', 'table'):
            for blocker, blocked in ((a, b), (b, a)):
                setup = (f"UPDATE profiles SET blocked_users=ARRAY['{blocked}'::uuid] WHERE id='{blocker}';" if store == 'array'
                         else f"INSERT INTO user_blocks VALUES ('{blocker}','{blocked}');")
                for viewer in (a, b):
                    sql(assertions + f"""BEGIN; {setup} {login(viewer)}
SELECT pg_temp.check_true((SELECT count(*) FROM messages WHERE id IN (1,4))=0, 'both unnamed DM variants hidden');
SELECT pg_temp.check_true((SELECT count(*) FROM message_reactions)=0, 'retained DM reactions hidden');
SELECT pg_temp.denied('INSERT INTO messages VALUES (10, ''{dm}'', null, ''{viewer}'', ''new contact'')', 'blocked send rejected');
SELECT pg_temp.denied('INSERT INTO message_reactions VALUES (10,1,''{viewer}'',''new reaction'')', 'blocked reaction rejected');
WITH changed AS (UPDATE messages SET content='edited contact' WHERE id=1 RETURNING id)
 SELECT pg_temp.check_true((SELECT count(*) FROM changed)=0, 'blocked message edit inaccessible');
WITH changed AS (UPDATE message_reactions SET emoji='edited' WHERE id=1 RETURNING id)
 SELECT pg_temp.check_true((SELECT count(*) FROM changed)=0, 'blocked reaction edit inaccessible');
SELECT pg_temp.check_true((SELECT count(*) FROM messages WHERE id IN (2,3,5))=3, 'named pairs, grown groups and event history preserved');
INSERT INTO messages VALUES (11, '10000000-0000-0000-0000-000000000002', null, '{viewer}', 'Group contact');
SELECT pg_temp.check_true((SELECT count(*) FROM messages WHERE id=11)=1, 'named pair send retains group semantics');
SELECT pg_temp.denied('UPDATE messages SET circle_id=''{dm}'' WHERE id=11', 'cannot move a group message into blocked DM');
INSERT INTO message_reactions VALUES (11,11,'{viewer}','group reaction');
SELECT pg_temp.denied('UPDATE message_reactions SET message_id=1 WHERE id=11', 'cannot move a reaction into blocked DM');
RESET ROLE;
SELECT pg_temp.check_true((SELECT count(*) FROM messages WHERE id=1)=1, 'original evidence retained');
ROLLBACK;""")
        sql(assertions + f"""BEGIN; {login(a)}
SELECT pg_temp.check_true((SELECT count(*) FROM messages WHERE id=1)=1, 'unblocked history visible');
INSERT INTO messages VALUES (10, '{dm}', null, '{a}', 'Unblocked send');
INSERT INTO message_reactions VALUES (10,1,'{a}','new');
SELECT pg_temp.check_true((SELECT count(*) FROM messages WHERE id=10)=1, 'unblocked send works');
SELECT pg_temp.check_true((SELECT count(*) FROM message_reactions WHERE id=10)=1, 'unblocked reaction works');
SELECT pg_temp.denied('INSERT INTO messages VALUES (11, ''{dm}'', null, ''{b}'', ''forged sender'')', 'existing sender policy retained');
ROLLBACK;
BEGIN; {login('00000000-0000-0000-0000-000000000004')}
SELECT pg_temp.check_true(NOT private_chat_contact_allowed('{dm}'), 'outsider contact denied');
SELECT pg_temp.check_true((SELECT count(*) FROM messages WHERE circle_id IS NOT NULL)=0, 'outsider cannot bypass restrictive policy');
ROLLBACK;
SELECT pg_temp.check_true(NOT has_function_privilege('anon','public.private_chat_contact_allowed(uuid)','EXECUTE'), 'anonymous helper access revoked');
BEGIN;
UPDATE profiles SET blocked_users=ARRAY['{b}'::uuid] WHERE id='{a}';
WITH changed AS (UPDATE profiles SET blocked_users=ARRAY['00000000-0000-0000-0000-000000000003'::uuid]
 WHERE id='{a}' AND blocked_users='{{}}'::uuid[] RETURNING id)
 SELECT pg_temp.check_true((SELECT count(*) FROM changed)=0, 'stale array update cannot overwrite concurrent block');
SELECT pg_temp.check_true((SELECT blocked_users FROM profiles WHERE id='{a}')=ARRAY['{b}'::uuid], 'concurrent block remains stored');
ROLLBACK;""")
        # Execute exact catalog-exported SECURITY DEFINER routines, not mocks.
        sql((root / 'supabase/tests/contracts/20261007_private_chat_rpc_fixture.sql').read_text())
        policy_source = (root / 'docs/database/review-only/20261007120000_private_chat_block_boundary.sql').read_text()
        sql(policy_source[policy_source.index('CREATE POLICY private_chat_reaction_select'):].replace('COMMIT;', ''))
        routines = json.loads((root / 'supabase/tests/contracts/20261007_private_chat_live_routines.json').read_text())
        signatures = {}
        for routine in routines:
            if hashlib.md5(routine['definition'].encode()).hexdigest() != routine['md5']:
                raise RuntimeError('Catalog fixture fingerprint mismatch: ' + routine['name'])
            sql(routine['definition'] + ';')
            # CREATE's default public execute is not representative of production.
            identity = routine['identity']
            signature = f"public.{routine['name']}({identity})"
            sql(f"REVOKE ALL ON FUNCTION {signature} FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION {signature} TO authenticated;")
            arg_types = ','.join(arg.strip().split(' ',1)[1] for arg in identity.split(',') if arg.strip())
            signatures[routine['name']] = f"public.{routine['name']}({arg_types})"
        mid = '30000000-0000-0000-0000-000000000001'
        def edit_call(name, message=mid, conversation=dm, kind='circle', expected='Retained history', content='Edited fixture'):
            args = f"'{message}','{kind}','{conversation}','{expected}','{content}'"
            if name.endswith('_with_mentions'):
                args += ",null,null"
            return f"public.{name}({args})"
        edits = ('edit_own_chat_message', 'edit_own_chat_message_with_mentions')
        sql(assertions + f"""BEGIN;
UPDATE profiles SET blocked_users=ARRAY['{b}'::uuid] WHERE id='{a}';
{login(a)}
SELECT pg_temp.check_true(get_circle('{dm}')->'members' IS NOT NULL, 'baseline definer leaks retained member photos');
SELECT pg_temp.check_true(jsonb_array_length(get_circle_chat_messages('{dm}'))=1, 'baseline definer bypasses message RLS');
SELECT pg_temp.check_true(jsonb_array_length(get_my_circle_chat_cards())=4, 'baseline definer leaks blocked inbox preview');
ROLLBACK;""")
        for name in edits:
            sql(assertions + f"""BEGIN;
UPDATE profiles SET blocked_users=ARRAY['{b}'::uuid] WHERE id='{a}';
{login(a)}
SELECT pg_temp.check_true({edit_call(name)}->>'status'='saved', 'baseline definer permits blocked edit');
ROLLBACK;""")
        rpc_candidate = (root / 'docs/database/review-only/20261007140000_private_chat_rpc_block_boundary.sql').read_text()
        # Source drift must roll back even the routines patched earlier in the loop.
        circle_routine = next(r for r in routines if r['name'] == 'get_circle')
        sql(circle_routine['definition'].replace('BEGIN', 'BEGIN\n -- simulated later source change', 1) + ';')
        rejected = subprocess.run([str(bin_dir / 'psql'), '-X', '-v', 'ON_ERROR_STOP=1'],
            input=rpc_candidate, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if rejected.returncode == 0 or 'Private-chat routine changed since review: get_circle' not in rejected.stdout:
            raise RuntimeError('RPC source drift was not rejected as expected: ' + rejected.stdout)
        checks += 1
        sql(assertions + "SELECT pg_temp.check_true(md5(pg_get_functiondef('public.edit_own_chat_message(uuid,text,uuid,text,text)'::regprocedure))='24435e62bdc5019d0a393faa67205c13', 'drift abort rolls back earlier changes');")
        sql(circle_routine['definition'] + ';')
        sql(rpc_candidate)
        rpc_denied = """
CREATE OR REPLACE FUNCTION pg_temp.rpc_denied(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'not a member of this circle' THEN RAISE NOTICE 'PASS: %', label; RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'FAIL (RPC allowed): %', label;
END $$;
"""
        for store in ('array','table'):
            for blocker, blocked in ((a,b),(b,a)):
                setup = (f"UPDATE profiles SET blocked_users=ARRAY['{blocked}'::uuid] WHERE id='{blocker}';" if store == 'array'
                         else f"INSERT INTO user_blocks VALUES ('{blocker}','{blocked}');")
                for viewer in (a,b):
                    edit_assertions = '\n'.join(f"SELECT pg_temp.check_true({edit_call(name)}->>'status'='unavailable', 'blocked definer edit denied');" for name in edits)
                    sql(assertions + rpc_denied + f"""BEGIN; {setup}
UPDATE messages SET user_id='{viewer}' WHERE id='{mid}';
{login(viewer)}
SELECT pg_temp.rpc_denied('SELECT get_circle(''{dm}'')', 'blocked member detail denied');
SELECT pg_temp.rpc_denied('SELECT get_circle_chat_messages(''{dm}'')', 'blocked history denied');
SELECT pg_temp.rpc_denied('SELECT get_circle(''10000000-0000-0000-0000-000000000004'')', 'whitespace-name DM detail denied');
SELECT pg_temp.check_true(jsonb_array_length(get_my_circle_chat_cards())=2, 'inbox omits both blocked DM variants');
SELECT pg_temp.check_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(get_my_circle_chat_cards()) card WHERE card->>'circle_id'='{dm}'), 'no retained private preview or avatar');
SELECT pg_temp.check_true(jsonb_array_length(get_circle_chat_messages('10000000-0000-0000-0000-000000000002'))=1, 'named group history preserved');
SELECT pg_temp.check_true(get_circle('10000000-0000-0000-0000-000000000003')->'members' IS NOT NULL, 'grown group detail preserved');
{edit_assertions}
RESET ROLE;
SELECT pg_temp.check_true((SELECT content FROM messages WHERE id='{mid}')='Retained history', 'blocked edit did not mutate retained evidence');
ROLLBACK;""")
        for name in edits:
            for kind, conversation, message in (
                ('circle',dm,mid),
                ('circle','10000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002'),
                ('event','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000005')):
                expected = 'Event history' if kind=='event' else 'Retained history'
                sql(assertions + f"""BEGIN; {login(a)}
SELECT pg_temp.check_true({edit_call(name,message,conversation,kind,expected)}->>'status'='saved', 'allowed DM/group/event edit preserved');
SELECT pg_temp.check_true({edit_call(name,message,conversation,kind,'stale','Next fixture')}->>'status'='changed', 'edit compare-and-swap preserved');
ROLLBACK;""")
        sql(assertions + rpc_denied + f"""BEGIN; {login(a)}
SELECT pg_temp.check_true(jsonb_array_length(get_my_circle_chat_cards())=4, 'unblocked inbox retained');
SELECT pg_temp.check_true(get_circle('{dm}')->'members' IS NOT NULL, 'unblocked member detail retained');
SELECT pg_temp.check_true(jsonb_array_length(get_circle_chat_messages('{dm}'))=1, 'unblocked history retained');
ROLLBACK;
BEGIN; {login('00000000-0000-0000-0000-000000000004')}
SELECT pg_temp.check_true(get_my_circle_chat_cards()='[]'::jsonb, 'outsider inbox empty');
SELECT pg_temp.rpc_denied('SELECT get_circle(''{dm}'')', 'outsider detail denied');
ROLLBACK;
BEGIN;
UPDATE profiles SET suspended_until=now()+interval '1 day' WHERE id='{a}';
{login(a)}
SELECT pg_temp.check_true({edit_call(edits[0])}->>'status'='unavailable', 'account hold preserved');
ROLLBACK;
BEGIN;
UPDATE events SET status='cancelled';
{login(a)}
SELECT pg_temp.check_true({edit_call(edits[1],'30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','event','Event history')}->>'status'='closed', 'cancelled event write window preserved');
ROLLBACK;""")
        for name, signature in signatures.items():
            sql(assertions + f"SELECT pg_temp.check_true(NOT has_function_privilege('anon','{signature}','EXECUTE') AND has_function_privilege('authenticated','{signature}','EXECUTE'), 'RPC grants preserved: {name}');")
        sql((root / 'scripts/db-contracts/inspect-private-chat-blocks.sql').read_text())
        print(json.dumps({'passed_assertions': checks, 'database': 'disposable Unix socket only',
                          'candidate_deployed': False, 'live_routine_bodies_verified': True, 'full_live_schema_verified': False}))
    finally:
        if started:
            command([str(bin_dir / 'pg_ctl'), '-D', str(data), '-m', 'fast', '-w', 'stop'])
