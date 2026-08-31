\set ON_ERROR_STOP on
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('transactional-email-drain', 'audience-sync-drain')) THEN
    RAISE EXCEPTION 'rescue did not unschedule both delivery workers';
  END IF;
  IF (SELECT activation_mode FROM public.delivery_runtime_config WHERE singleton) IS DISTINCT FROM 'quarantined' THEN
    RAISE EXCEPTION 'rescue did not quarantine delivery';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname IN ('enqueue_free_rsvp_confirmation_trigger', 'profile_consent_evidence_enqueue_trigger', 'profile_consent_metadata_guard_trigger')
       AND tgenabled <> 'O'
  ) THEN RAISE EXCEPTION 'rescue restore did not re-enable exact triggers'; END IF;
END $$;
SELECT 'PASS exact G0 rescue SQL parses and restores named triggers' AS result;
