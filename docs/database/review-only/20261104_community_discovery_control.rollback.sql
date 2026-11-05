-- REVIEW ONLY. Removes only these two exact discovery RPCs; no community data is changed.
BEGIN;
DO $guard$ BEGIN
 IF to_regprocedure('public.get_community_visibility_options(uuid)') IS NULL
 OR md5(pg_get_functiondef('public.get_community_visibility_options(uuid)'::regprocedure)) <> '1953ffed81ba183d8f53ee5c7949abd9'
 OR to_regprocedure('public.set_community_discoverable(uuid,text,boolean,boolean)') IS NULL
 OR md5(pg_get_functiondef('public.set_community_discoverable(uuid,text,boolean,boolean)'::regprocedure)) <> '0514f77cbc12424dedfa479cbc58a203' THEN
  RAISE EXCEPTION 'Discovery functions changed; inspect before rollback';
 END IF;
END $guard$;
DROP FUNCTION public.set_community_discoverable(uuid,text,boolean,boolean);
DROP FUNCTION public.get_community_visibility_options(uuid);
COMMIT;
