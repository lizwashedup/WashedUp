-- REVIEW ONLY / NOT DEPLOYED. One missing column permission, no row changes.
-- Existing communities_update RLS still decides who may edit each community.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.communities IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.communities'::regclass)
 OR (SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY policyname)::text) FROM pg_policies p
     WHERE schemaname='public' AND tablename='communities') IS DISTINCT FROM '422a4716b340e3fb9b758f6c34bfbb15'
 OR md5(pg_get_functiondef('public.is_community_leader(uuid,uuid)'::regprocedure)) <> 'd9a2d97a0ef34d456087e6df78a8c73d'
 OR md5(pg_get_functiondef('public.creator_community_is_visible(uuid)'::regprocedure)) <> 'f8b427f7f67d2f16eb4294b6a56b8d6a'
 OR md5(pg_get_functiondef('public.creator_page_is_visible(uuid)'::regprocedure)) <> '4c3bf6aa1883eb85c377e75e8fe63133' THEN
  RAISE EXCEPTION 'Community authority changed; inspect before applying';
 END IF;
 IF (SELECT attacl FROM pg_attribute WHERE attrelid='public.communities'::regclass AND attname='purpose') IS NOT NULL
 OR has_column_privilege('authenticated','public.communities','purpose','UPDATE')
 OR has_column_privilege('anon','public.communities','purpose','UPDATE')
 OR NOT has_column_privilege('authenticated','public.communities','name','UPDATE') THEN
  RAISE EXCEPTION 'Community identity grants changed; inspect before applying';
 END IF;
 IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.communities'::regclass AND conname='communities_purpose_check')
 IS DISTINCT FROM 'CHECK (((purpose IS NULL) OR ((char_length(purpose) >= 10) AND (char_length(purpose) <= 140))))' THEN
  RAISE EXCEPTION 'Community description validation changed; inspect before applying';
 END IF;
END $guard$;
GRANT UPDATE(purpose) ON public.communities TO authenticated;
COMMIT;
