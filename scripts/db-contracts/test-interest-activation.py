"""Concurrency contract for a disposable, fixture-only Docker database."""
import json
from pathlib import Path
import subprocess
import sys
import time

r = Path(__file__).resolve().parents[2]
container = sys.argv[1]
name = subprocess.check_output(['docker','inspect','--format','{{.Name}}',container],text=True).strip()
if not name.startswith('/washedup-db-contracts-') or not name.removeprefix('/washedup-db-contracts-').isdigit():
    raise RuntimeError('Expected the private contract runner’s disposable container')
psql = ['docker','exec','-i',container,'psql','-U','postgres','-d','interest_activation_contract','-XqAt','-v','ON_ERROR_STOP=1']
def sql(statement):
    return subprocess.run(psql,input=statement,capture_output=True,text=True,check=True).stdout.strip()

a = '11111111-1111-4111-8111-111111111111'
plan='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
creator='22222222-2222-4222-8222-222222222222'
ddl=(r/'supabase/migrations/20260504100000_event_interest_signals.sql').read_text()
ddl=ddl[ddl.index('create table if not exists public.event_interest_signals'):ddl.index('create index if not exists event_interest_signals_creator_active_idx')]
latest=(r/'supabase/migrations/20260611000100_interest_signal_reshow_fix.sql').read_text()
start=latest.index('CREATE OR REPLACE FUNCTION public.send_interest_signal');end=latest.index('$function$;',start)+len('$function$;')
sql(f"""create schema auth;create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
  create table events(id uuid primary key,creator_user_id uuid,start_time timestamptz,end_time timestamptz,title text);
  create table profiles(id uuid primary key,first_name_display text);
  create table event_members(event_id uuid,user_id uuid,status text);
  create table app_notifications(user_id uuid,type text,title text,body text,event_id uuid,actor_user_id uuid);
  create function _users_blocked(uuid,uuid) returns boolean language sql stable as $$select false$$;
  create function _event_is_past(timestamptz,timestamptz) returns boolean language sql stable as $$select false$$;
  insert into profiles values('{a}','Sample member'),('{creator}','Sample creator');
  insert into events values('{plan}','{creator}',now()+interval '1 day',now()+interval '2 days','Fictional local plan');""")
sql(ddl)
sql("alter table event_interest_signals add column reactivated_at timestamptz")
sql(latest[start:end])
sql("do $$ begin if not exists(select from pg_roles where rolname='authenticated')then create role authenticated;end if;if not exists(select from pg_roles where rolname='anon')then create role anon;end if;end $$; grant usage on schema auth to authenticated;revoke all on function public.send_interest_signal(uuid) from public,anon;grant execute on function public.send_interest_signal(uuid) to authenticated;")
attributes="select row_to_json(x) from (select oid,proowner,prosecdef,proconfig,proacl,provolatile from pg_proc where oid='public.send_interest_signal(uuid)'::regprocedure) x"
before=sql(attributes)
sql((r/'docs/database/review-only/20261106022000_one_interest_activation_notification.sql').read_text())
assert before==sql(attributes)
assert sql("select has_function_privilege('authenticated','public.send_interest_signal(uuid)','execute'), has_function_privilege('anon','public.send_interest_signal(uuid)','execute')")=='t|f'
print('PASS: patched existing function preserved identity, owner, definer mode, search path and exact grants; anonymous execution remains denied.',flush=True)
claim="set request.jwt.claims='"+json.dumps({'sub':a})+"';"
call=f"select send_interest_signal('{plan}');"
args=psql
with subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True) as held:
 held.stdin.write(claim+'begin;'+call+'\n');held.stdin.flush()
 first=held.stdout.readline().strip();assert len(first)==36
 assert sql("select count(*) from event_interest_signals where id='"+first+"';")=='0'
 with subprocess.Popen(args+['-c',"set application_name='concurrent_exact_retry';"+claim+call],stdout=subprocess.PIPE,text=True) as retry:
  try:
   for i in range(50):
    if sql("select count(*) from pg_stat_activity where application_name='concurrent_exact_retry' and wait_event_type='Lock'")=='1':break
    time.sleep(.05)
   else:raise RuntimeError('No lock contention observed')
  finally:held.stdin.write('commit;\n');held.stdin.flush()
  assert retry.communicate(timeout=5)[0].strip()==first and retry.returncode==0
 held.stdin.close();assert held.wait(timeout=5)==0
assert sql("select count(*) from event_interest_signals where id='"+first+"';")=='1'
n=lambda:sql("select count(*) from app_notifications where type='interest_signal'")
assert n()=='1'
assert sql(claim+call)==first and n()=='1'
sql("update event_interest_signals set status='removed',expired_at=now(),expiry_reason='user_removed',skip_count=2 where id='"+first+"';")
assert sql(claim+call)==first and n()=='2'
assert sql("select status='active' and skip_count=0 and expired_at is null and expiry_reason is null and reactivated_at is not null from event_interest_signals where id='"+first+"'")=='t'
assert sql(claim+call)==first and n()=='2'
print('PASS interest activation: one active row and one local creator notification row for concurrent requests; subsequent active repeat adds none. An explicit re-raise of a removed signal keeps its ID, clears obsolete fields, stamps the reactivation and adds one new local notification row. External delivery disabled.')
