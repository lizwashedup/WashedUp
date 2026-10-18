#!/usr/bin/env python3
"""Disposable socket-only PostgreSQL integration tests; never accepts a DB URL."""
import json, os, subprocess, sys, tempfile, hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[2]
bin_dir=Path(sys.argv[1]).resolve()
for name in ('initdb','pg_ctl','psql'):
    if not (bin_dir/name).is_file():raise SystemExit('Missing '+name)
env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
a,b,c,d,admin=[f'00000000-0000-0000-0000-00000000000{i}' for i in range(1,6)]
e='10000000-0000-0000-0000-000000000001'; past='10000000-0000-0000-0000-000000000002';msg='20000000-0000-0000-0000-000000000001'
checks=0
assertions="""
CREATE OR REPLACE FUNCTION pg_temp.ok(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END$$;
CREATE OR REPLACE FUNCTION pg_temp.denied(statement text,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE statement; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: %',label; RETURN; END; RAISE EXCEPTION 'FAIL allowed: %',label; END$$;
"""
def login(uid):return f"SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='{uid}';"
with tempfile.TemporaryDirectory(prefix='wu-plan-moderation-',dir='/tmp') as temp:
    work=Path(temp);socket=work/'s';socket.mkdir(mode=0o700);data=work/'data'
    env.update(PGHOST=str(socket),PGPORT='55479',PGDATABASE='postgres',PGUSER='fixture_owner')
    def cmd(args):return subprocess.run(args,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,check=True)
    def sql(text,fail=False):
        global checks
        r=subprocess.run([str(bin_dir/'psql'),'-X','-v','ON_ERROR_STOP=1'],input=text,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        if r.returncode and not fail:raise RuntimeError(r.stdout)
        checks+=r.stdout.count('PASS:');return r
    def case(body):sql(assertions+'BEGIN;'+body+'ROLLBACK;')
    started=False
    try:
        cmd([str(bin_dir/'initdb'),'-D',str(data),'-U','fixture_owner','--auth=trust','--no-locale'])
        cmd([str(bin_dir/'pg_ctl'),'-D',str(data),'-l',str(work/'postgres.log'),'-o',f"-h '' -k {socket} -p 55479",'-w','start']);started=True
        sql((root/'supabase/tests/contracts/20261018_moderation_fixture.sql').read_text())
        routines=json.loads((root/'supabase/tests/contracts/20261018_moderation_live_routines.json').read_text())
        for r in routines:
            assert hashlib.md5(r['definition'].encode()).hexdigest()==r['md5']
            sql(r['definition'])
        sql('''CREATE TRIGGER trg_expire_interests_on_block AFTER UPDATE OF blocked_users ON profiles FOR EACH ROW EXECUTE FUNCTION expire_interests_on_block();
CREATE TRIGGER on_report_auto_ban AFTER INSERT ON reports FOR EACH ROW EXECUTE FUNCTION auto_ban_reported_user();
CREATE TRIGGER trg_auto_dismiss_block_report BEFORE INSERT ON reports FOR EACH ROW EXECUTE FUNCTION auto_dismiss_block_report();''')
        case(login(a)+f"UPDATE profiles SET blocked_users=ARRAY['{b}'::uuid] WHERE id='{a}'; RESET ROLE; SELECT pg_temp.ok((SELECT status='joined' FROM event_members WHERE event_id='{e}' AND user_id='{b}'),'baseline reproduces failed cross-user cleanup');")
        case(login(a)+f"SELECT report_no_show('{e}','{b}'); RESET ROLE; SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM reports WHERE reported_event_id='{e}'),'baseline no-show misses review queue');")
        block=(root/'supabase/migrations/20261018220000_plan_block_enforcement.sql').read_text()
        reports=(root/'supabase/migrations/20261018221000_report_review_queue.sql').read_text()
        # Drift must abort before any candidate change becomes durable.
        original=next(r['definition'] for r in routines if r['name']=='join_event_atomic')
        sql(original.replace('BEGIN','BEGIN\n -- later unrelated source change',1))
        r=sql(block,fail=True)
        assert r.returncode and 'changed since review' in r.stdout
        sql(assertions+"SELECT pg_temp.ok(to_regprocedure('public.enforce_plan_block_pair(uuid,uuid)') IS NULL,'drift rolls back all enforcement changes');")
        sql(original);sql(block);sql(reports)
        for store in ('array','table'):
            for blocker,blocked,removed in ((a,b,b),(b,a,b),(b,c,c)):
                setup=(f"UPDATE profiles SET blocked_users=ARRAY['{blocked}'::uuid] WHERE id='{blocker}';" if store=='array' else f"INSERT INTO user_blocks(blocker_id,blocked_id) VALUES('{blocker}','{blocked}');")
                case(login(blocker)+setup+f"""RESET ROLE;
SELECT pg_temp.ok((SELECT status='removed' FROM event_members WHERE event_id='{e}' AND user_id='{removed}'),'authenticated block removes correct guest: {store}');
SELECT pg_temp.ok((SELECT status='joined' FROM event_members WHERE event_id='{e}' AND user_id='{a}'),'creator preserved');
SELECT pg_temp.ok((SELECT member_count=3 FROM events WHERE id='{e}'),'member count refreshed');
SELECT pg_temp.ok((SELECT status='joined' FROM event_members WHERE event_id='{past}' AND user_id='{removed}'),'completed history membership preserved');
SELECT pg_temp.ok((SELECT count(*) FROM messages WHERE id='{msg}')=1,'message evidence preserved');
{login(removed)}
SELECT pg_temp.denied('UPDATE event_members SET status=''joined'' WHERE event_id=''{e}'' AND user_id=''{removed}''','direct rejoin blocked');
SELECT pg_temp.denied('SELECT join_event_atomic(''{e}'',''{removed}'')','RPC rejoin blocked');
SELECT pg_temp.ok(NOT plan_chat_contact_allowed('{e}'),'removed guest lacks plan chat access');
SELECT pg_temp.ok((SELECT count(*) FROM messages WHERE event_id='{e}')=0,'removed guest cannot read plan chat');
SELECT pg_temp.denied('INSERT INTO messages(event_id,user_id,content) VALUES(''{e}'',''{removed}'',''contact'')','removed guest cannot send');
SELECT pg_temp.ok(edit_own_chat_message('{msg}','event','{e}','Retained evidence','changed')->>'status'='unavailable','definer edit blocked');
SELECT pg_temp.ok(edit_own_chat_message_with_mentions('{msg}','event','{e}','Retained evidence','changed',null,null)->>'status'='unavailable','mention definer edit blocked');
RESET ROLE;
{login(a)}
SELECT pg_temp.ok(plan_chat_contact_allowed('{e}'),'creator keeps chat access');
""")
        case(f"UPDATE profiles SET suspended_until=now()+interval '1 day' WHERE id='{b}'; UPDATE event_members SET status='left' WHERE event_id='{e}' AND user_id='{b}';"+login(b)+f"SELECT pg_temp.denied('SELECT join_event_atomic(''{e}'',''{b}'')','hold cannot be bypassed by rejoin update');")
        case(login(a)+f"UPDATE profiles SET blocked_users=ARRAY['{b}'::uuid] WHERE id='{a}'; UPDATE profiles SET blocked_users='{{}}' WHERE id='{a}'; RESET ROLE; SELECT pg_temp.ok((SELECT status='removed' FROM event_members WHERE event_id='{e}' AND user_id='{b}'),'unblock does not auto-rejoin');"+login(b)+f"SELECT pg_temp.ok(join_event_atomic('{e}','{b}')='joined','unblocked explicit rejoin works');")
        case(f"UPDATE events SET circle_id='40000000-0000-0000-0000-000000000001',circle_visibility='open',stranger_cap=10 WHERE id='{e}';"+login(a)+f"UPDATE profiles SET blocked_users=ARRAY['{b}'::uuid] WHERE id='{a}';RESET ROLE;"+login(b)+f"SELECT pg_temp.denied('SELECT join_circle_plan_atomic(''{e}'',''{b}'')','Circle-plan RPC cannot bypass block');")
        case(login(a)+f"INSERT INTO reports(id,reporter_user_id,reported_user_id,reason,status,admin_notes,reviewed_at,reviewed_by_admin_id) VALUES('30000000-0000-0000-0000-000000000002','{a}','{b}','Fixture complaint','resolved','forged',now(),'{admin}'); RESET ROLE; SELECT pg_temp.ok((SELECT status='pending' AND admin_notes IS NULL AND reviewed_at IS NULL AND reviewed_by_admin_id IS NULL FROM reports WHERE id='30000000-0000-0000-0000-000000000002'),'review fields cannot be forged'); SELECT pg_temp.ok(EXISTS(SELECT 1 FROM report_review_tasks WHERE report_id='30000000-0000-0000-0000-000000000002'),'report has durable task'); SELECT dispatch_report_review_alerts(); SELECT dispatch_report_review_alerts(); SELECT pg_temp.ok((SELECT count(*) FROM app_notifications WHERE title='A member report needs review')=1,'new report alerted once'); SELECT pg_temp.ok((SELECT count(*) FROM app_notifications WHERE title='Member reports are overdue')=1,'overdue backlog digest deduplicated');")
        case(login(a)+f"SELECT report_no_show('{e}','{b}');SELECT report_no_show('{e}','{b}');RESET ROLE;SELECT pg_temp.ok((SELECT count(*) FROM reports WHERE reported_event_id='{e}' AND reason='No-show to plan')=1,'no-show enters review once');SELECT pg_temp.ok((SELECT count(*) FROM report_review_tasks)=2,'no-show has durable task');")
        case(login(a)+f"INSERT INTO reports(reporter_user_id,reported_user_id,reason) VALUES('{a}','{b}','Blocked by user'); RESET ROLE; SELECT pg_temp.ok((SELECT count(*) FROM report_review_tasks)=1,'block telemetry does not create allegation task');")
        case(login(b)+"SELECT pg_temp.denied('SELECT admin_get_report_review_queue()','nonadmin cannot read queue');SELECT pg_temp.denied('SELECT admin_review_report(''30000000-0000-0000-0000-000000000001'',''resolved'',''forged'',''pending'')','nonadmin cannot review');")
        case(login(admin)+"SELECT pg_temp.ok(jsonb_array_length(admin_get_report_review_queue())=1,'admin can retrieve pending queue');SELECT admin_review_report('30000000-0000-0000-0000-000000000001','reviewed','Investigating','pending');RESET ROLE;SELECT pg_temp.ok((SELECT reviewed_at IS NOT NULL AND reviewed_by_admin_id='"+admin+"' FROM reports WHERE id='30000000-0000-0000-0000-000000000001'),'review receipt stamped');SELECT pg_temp.ok((SELECT count(*) FROM moderation_actions WHERE action='report_review')=1,'review audit retained');SELECT pg_temp.ok(dispatch_report_review_alerts()=0,'reviewed case no longer escalates');")
        case("DELETE FROM admin_alert_recipients; SELECT pg_temp.ok(dispatch_report_review_alerts()=0,'missing recipient does not discard reports');SELECT pg_temp.ok(EXISTS(SELECT 1 FROM report_review_tasks WHERE last_error IS NOT NULL),'missing recipient visible in queue');")
        case(login(a)+f"INSERT INTO reports(reporter_user_id,reported_user_id,reason) SELECT '{a}','{b}','Repeat complaint' FROM generate_series(1,3);RESET ROLE;SELECT pg_temp.ok((SELECT banned_until IS NULL FROM auth.users WHERE id='{b}'),'same reporter cannot trigger three-reporter ban');")
        case(f"INSERT INTO reports(reporter_user_id,reported_user_id,reason) VALUES('{c}','{b}','Other complaint'),('{d}','{b}','Third complaint');SELECT pg_temp.ok((SELECT banned_until>now() FROM auth.users WHERE id='{b}'),'existing three-independent-reporter threshold preserved');")
        case(f"UPDATE events SET start_time=now()+interval '1 day' WHERE id='{e}';"+login(a)+f"SELECT pg_temp.denied('SELECT report_no_show(''{e}'',''{b}'')','future no-show rejected');RESET ROLE;SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM no_show_reports),'invalid no-show rolls back both stores');")
        case(login(admin)+"SELECT admin_review_report('30000000-0000-0000-0000-000000000001','dismissed','Not supported by evidence','pending');RESET ROLE;"+login(c)+f"INSERT INTO reports(reporter_user_id,reported_user_id,reason) VALUES('{c}','{b}','Other complaint');RESET ROLE;"+login(d)+f"INSERT INTO reports(reporter_user_id,reported_user_id,reason) VALUES('{d}','{b}','Third complaint');RESET ROLE;SELECT pg_temp.ok((SELECT banned_until IS NULL FROM auth.users WHERE id='{b}'),'dismissed report excluded from automatic threshold');")
        case(login(a)+f"INSERT INTO reports(reporter_user_id,reported_user_id,reported_event_id,reason) VALUES('{a}','{b}','{e}','No-show to plan'); SELECT report_no_show('{e}','{b}');RESET ROLE;SELECT pg_temp.ok((SELECT count(*) FROM reports WHERE reported_event_id='{e}')=1,'feedback does not duplicate existing general report');")
        sql(assertions+"SELECT pg_temp.ok(NOT has_function_privilege('anon','public.admin_get_report_review_queue(integer)','EXECUTE'),'anonymous queue access denied');SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.enforce_plan_block_pair(uuid,uuid)','EXECUTE'),'internal cross-user cleanup cannot be called directly');")
        # Two real sessions prove a waiting join sees a committed block, not the
        # snapshot from before the mutex wait. No production traffic involved.
        first=subprocess.Popen([str(bin_dir/'psql'),'-X','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,text=True)
        first.stdin.write(f"BEGIN;{login(a)} UPDATE profiles SET blocked_users=ARRAY['{b}'::uuid] WHERE id='{a}'; SELECT 'BLOCK_LOCK_HELD'; SELECT pg_sleep(1); COMMIT;\n");first.stdin.close()
        while True:
            line=first.stdout.readline()
            if 'BLOCK_LOCK_HELD' in line:break
            if not line:raise RuntimeError('Block session failed before lock acknowledgement')
        result=sql(f"BEGIN;{login(b)} SELECT join_event_atomic('{e}','{b}');COMMIT;",fail=True)
        output=first.stdout.read();first.wait()
        assert first.returncode==0,output
        assert result.returncode and 'plan unavailable' in result.stdout,result.stdout
        sql(assertions+f"SELECT pg_temp.ok((SELECT status='removed' FROM event_members WHERE event_id='{e}' AND user_id='{b}'),'concurrent block wins over waiting RPC rejoin');")
        sql("CREATE TABLE rollback_snapshot AS SELECT (SELECT jsonb_agg(to_jsonb(m) ORDER BY event_id,user_id) FROM event_members m) AS members,(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM reports r) AS reports;")
        sql((root/'docs/moderation/20261018-enforcement.rollback.sql').read_text())
        sql(assertions+"SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='report-review-alerts'),'rollback stops only the added scheduler');SELECT pg_temp.ok((SELECT members=(SELECT jsonb_agg(to_jsonb(m) ORDER BY event_id,user_id) FROM event_members m) AND reports=(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM reports r) FROM rollback_snapshot),'rollback preserves memberships and reports');SELECT pg_temp.ok((SELECT count(*) FROM report_review_tasks)=1,'rollback retains durable review evidence');")
        for r in routines:
            if r['name'] in ('expire_interests_on_block','join_event_atomic','join_circle_plan_atomic','edit_own_chat_message','edit_own_chat_message_with_mentions','report_no_show','auto_ban_reported_user'):
                sql(assertions+f"SELECT pg_temp.ok(md5(pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname='{r['name']}' AND pronamespace='public'::regnamespace)))='{r['md5']}','rollback restores original {r['name']}');")
        print(json.dumps({'passed_assertions':checks,'database':'disposable Unix socket only','production_data_used':False}))
    finally:
        if started:cmd([str(bin_dir/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'])
