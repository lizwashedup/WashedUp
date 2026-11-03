SET ROLE authenticated;
SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.get_user_interest_signals())<>2 THEN
    RAISE EXCEPTION 'Completed source plans lost valid next-time interest';
  END IF;
END $$;
SELECT public.remove_interest_signal('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
SELECT public.remove_interest_signal('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
SELECT public.report_no_show('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222');
SELECT public.report_no_show('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222');
DO $$ BEGIN
  BEGIN
    PERFORM public.report_no_show('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111');
    RAISE EXCEPTION 'self-report accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'cannot_report_self' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.report_no_show('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','99999999-9999-4999-8999-999999999999');
    RAISE EXCEPTION 'nonmember target accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'target_not_a_member' THEN RAISE; END IF; END;
END $$;
SET request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
DO $$ BEGIN
  BEGIN
    PERFORM public.remove_interest_signal('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    RAISE EXCEPTION 'removed another account interest';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM public.event_interest_signals WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' AND status='removed' AND expiry_reason='user_removed' AND expired_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Removal was not persisted';
  END IF;
  IF (SELECT count(*) FROM public.no_show_reports)<>1 THEN RAISE EXCEPTION 'Duplicate no-show report'; END IF;
END $$;
