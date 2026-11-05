-- REVIEW ONLY. Revoke only the added purpose UPDATE grant; keep saved data.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.communities IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF (SELECT attacl::text FROM pg_attribute WHERE attrelid='public.communities'::regclass AND attname='purpose')
 IS DISTINCT FROM '{authenticated=w/postgres}'
 OR has_table_privilege('authenticated','public.communities','UPDATE')
 OR has_column_privilege('anon','public.communities','purpose','UPDATE') THEN
  RAISE EXCEPTION 'Community description grants changed; inspect before rollback';
 END IF;
END $guard$;
REVOKE UPDATE(purpose) ON public.communities FROM authenticated;
COMMIT;
