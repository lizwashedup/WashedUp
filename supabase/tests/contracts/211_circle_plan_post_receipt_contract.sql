-- Disposable trust fixture + actual create_circle_plan + held receipt migration.
-- Provide auth.users populated from fictional profiles. Never run in production.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
DO $$
DECLARE c uuid; request uuid:=gen_random_uuid(); first jsonb; second jsonb;
BEGIN
 c:=public.create_circle('Receipt contract',null,ARRAY['00000000-0000-0000-0000-000000000002'::uuid]);
 IF public.circle_plan_post_status(c,request)->>'status'<>'unknown' THEN RAISE EXCEPTION 'Expected unresolved status'; END IF;
 first:=public.create_circle_plan_once(request,c,'Fictional walk','2040-11-08T19:00:00Z','circle_only',p_host_message=>'Meet at the fictional park.');
 second:=public.create_circle_plan_once(request,c,'Fictional walk','2040-11-08T19:00:00Z','circle_only',p_host_message=>'Meet at the fictional park.');
 IF first IS DISTINCT FROM second OR public.circle_plan_post_status(c,request) IS DISTINCT FROM first THEN RAISE EXCEPTION 'Receipt replay changed'; END IF;
 BEGIN
  PERFORM public.create_circle_plan_once(request,c,'Changed title','2040-11-08T19:00:00Z','circle_only',p_host_message=>'Meet at the fictional park.');
  RAISE EXCEPTION 'Changed payload accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 IF has_table_privilege('authenticated','public.circle_plan_post_receipts','SELECT') OR
    has_table_privilege('authenticated','public.circle_plan_post_receipts','INSERT') OR
    has_function_privilege('anon','public.circle_plan_post_status(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Receipt permissions too broad'; END IF;
END $$;
ROLLBACK;
