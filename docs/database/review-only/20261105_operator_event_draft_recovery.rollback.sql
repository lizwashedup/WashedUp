-- REVIEW ONLY. Withdraw new endpoints; keep private receipts and all events.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('cancel_operator_event_draft_attempt(uuid,jsonb)') AND md5(pg_get_functiondef(oid))='c3aa08c79c8b4db6d084940d3fff3e59' AND proacl=ARRAY['postgres=X/postgres','authenticated=X/postgres']::aclitem[]) THEN RAISE EXCEPTION 'Draft recovery routine changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('create_operator_event_draft(uuid,jsonb,uuid,text,integer,double precision,double precision)') AND md5(pg_get_functiondef(oid))='ecf318cecd34741546dc73f3b5f924ee' AND proacl=ARRAY['postgres=X/postgres','authenticated=X/postgres']::aclitem[]) THEN RAISE EXCEPTION 'Draft recovery routine changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('get_operator_event_draft_attempt(uuid)') AND md5(pg_get_functiondef(oid))='4f012c4e005d57babd0143e6b482ac61' AND proacl=ARRAY['postgres=X/postgres','authenticated=X/postgres']::aclitem[]) THEN RAISE EXCEPTION 'Draft recovery routine changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('get_operator_event_draft_capability()') AND md5(pg_get_functiondef(oid))='b7e1bd216504609a5895b0ce9e76af5f' AND proacl=ARRAY['postgres=X/postgres','authenticated=X/postgres']::aclitem[]) THEN RAISE EXCEPTION 'Draft recovery routine changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('operator_event_draft_authorize(uuid)') AND md5(pg_get_functiondef(oid))='04da71d8bf42e369b8e19e747d72b841' AND proacl=ARRAY['postgres=X/postgres']::aclitem[]) THEN RAISE EXCEPTION 'Draft recovery routine changed'; END IF;
 IF has_table_privilege('authenticated','public.operator_event_draft_attempts','SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('anon','public.operator_event_draft_attempts','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Draft receipt permissions changed'; END IF;
END $guard$;
DROP FUNCTION public.cancel_operator_event_draft_attempt(uuid,jsonb);
DROP FUNCTION public.get_operator_event_draft_capability();
DROP FUNCTION public.create_operator_event_draft(uuid,jsonb,uuid,text,integer,double precision,double precision);
DROP FUNCTION public.get_operator_event_draft_attempt(uuid);
DROP FUNCTION public.operator_event_draft_authorize(uuid);
COMMIT;
