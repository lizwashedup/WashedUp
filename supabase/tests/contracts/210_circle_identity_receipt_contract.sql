-- Disposable 52_circle_trust_fixture + trust/clear-cover/identity-receipt migrations.
-- The fixture must provide auth.users for the receipt's account-deletion FK.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
DO $$
DECLARE c uuid; request uuid := gen_random_uuid(); revision timestamptz; response jsonb; next_request uuid := gen_random_uuid();
BEGIN
 c := public.create_circle('Contract circle',null,ARRAY['00000000-0000-0000-0000-000000000002'::uuid]);
 revision := (public.circle_identity_save_status(c,request)->>'revision')::timestamptz;
 response := public.save_circle_identity_once(c,request,revision,'First name',null);
 IF response->>'status' <> 'saved' THEN RAISE EXCEPTION 'Expected saved receipt'; END IF;
 IF public.circle_identity_save_status(c,request)->>'status' <> 'saved' THEN RAISE EXCEPTION 'Exact receipt missing'; END IF;
 IF public.save_circle_identity_once(c,next_request,revision,'Stale name',null)->>'status' <> 'conflict' THEN RAISE EXCEPTION 'Stale revision overwrote current name'; END IF;
 revision := (public.circle_identity_save_status(c,gen_random_uuid())->>'revision')::timestamptz;
 IF public.save_circle_identity_once(c,gen_random_uuid(),revision,'Newer name',null)->>'status' <> 'saved' THEN RAISE EXCEPTION 'Fresh save refused'; END IF;
 -- The same ID cannot be repurposed to change payload, regardless of revision.
 BEGIN
   PERFORM public.save_circle_identity_once(c,request,revision,'Reused ID',null);
   RAISE EXCEPTION 'Changed payload accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 IF has_table_privilege('authenticated','public.circle_identity_receipts','SELECT') OR
    has_table_privilege('authenticated','public.circle_identity_receipts','INSERT') OR
    has_function_privilege('anon','public.save_circle_identity_once(uuid,uuid,timestamptz,text,text,uuid,boolean)','EXECUTE') THEN
   RAISE EXCEPTION 'Receipt grants too broad';
 END IF;
END $$;
ROLLBACK;
