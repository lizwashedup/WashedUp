DO $$ BEGIN
  IF md5(pg_get_functiondef('public.auto_link_explore_event()'::regprocedure)) <> (SELECT digest FROM original_function) THEN
    RAISE EXCEPTION 'Existing association function changed';
  END IF;
END $$;

SET ROLE authenticated;
SET request.jwt.claim.sub = '20000000-0000-4000-8000-000000000011';
INSERT INTO public.events(id,title) VALUES ('20000000-0000-4000-8000-000000000021','Salsa party');
INSERT INTO public.events(id,title,status,skip_explore_auto_link)
 VALUES ('20000000-0000-4000-8000-000000000022','Salsa party','draft',true);
INSERT INTO public.events(id,title,skip_explore_auto_link)
 VALUES ('20000000-0000-4000-8000-000000000023','Salsa party',true);
INSERT INTO public.events(id,title,explore_event_id,skip_explore_auto_link)
 VALUES ('20000000-0000-4000-8000-000000000024','Salsa party','20000000-0000-4000-8000-000000000002',true);
UPDATE public.events SET status='forming' WHERE id='20000000-0000-4000-8000-000000000022';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM public.events WHERE id='20000000-0000-4000-8000-000000000021' AND explore_event_id='20000000-0000-4000-8000-000000000001' AND skip_explore_auto_link=false) THEN
    RAISE EXCEPTION 'Ordinary creation behavior changed';
  END IF;
  IF (SELECT count(*) FROM public.events WHERE id IN ('20000000-0000-4000-8000-000000000022','20000000-0000-4000-8000-000000000023') AND explore_event_id IS NULL AND skip_explore_auto_link=true AND status='forming') <> 2 THEN
    RAISE EXCEPTION 'Independent copies were linked, including a resumed draft';
  END IF;
  IF NOT EXISTS (SELECT FROM public.events WHERE id='20000000-0000-4000-8000-000000000024' AND explore_event_id='20000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'Explicit new association was lost';
  END IF;
  BEGIN
    INSERT INTO public.events(title,creator_user_id,skip_explore_auto_link)
      VALUES ('Salsa party','20000000-0000-4000-8000-000000000012',true);
    RAISE EXCEPTION 'Opt-out bypassed creator ownership';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SET request.jwt.claim.sub = '20000000-0000-4000-8000-000000000012';
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.events) THEN RAISE EXCEPTION 'Opt-out changed source visibility'; END IF;
END $$;
RESET ROLE;
