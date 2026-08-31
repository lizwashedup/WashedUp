-- Restore phone signup after the audience-consent rollout introduced
-- unqualified pgcrypto calls into SECURITY DEFINER functions whose search
-- path only included public. Supabase installs pgcrypto in extensions.
--
-- Keep this repair narrow: changing function configuration preserves the
-- deployed bodies and ACLs, including the separately hardened suppression
-- function grant.

BEGIN;

DO $function$
BEGIN
  IF to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION 'extensions.digest(text,text) is required';
  END IF;
END;
$function$;

ALTER FUNCTION public.enqueue_audience_sync_for_email(text, boolean)
  SET search_path TO public, extensions;
ALTER FUNCTION public.profile_consent_metadata_guard()
  SET search_path TO public, extensions;
ALTER FUNCTION public.profile_consent_evidence_enqueue()
  SET search_path TO public, extensions;
ALTER FUNCTION public.quarantine_audience_webhook(text, text, text, text, text, text, boolean)
  SET search_path TO public, extensions;
ALTER FUNCTION public.reconcile_quarantined_audience_events(integer)
  SET search_path TO public, extensions;
ALTER FUNCTION public.record_audience_provider_event(text, text, text, text, text, text, text, text, boolean)
  SET search_path TO public, extensions;
ALTER FUNCTION public.record_audience_suppression(text, text, text)
  SET search_path TO public, extensions;
ALTER FUNCTION public.record_profile_consent_evidence()
  SET search_path TO public, extensions;

DO $function$
DECLARE
  v_function regprocedure;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.enqueue_audience_sync_for_email(text,boolean)'::regprocedure,
    'public.profile_consent_metadata_guard()'::regprocedure,
    'public.profile_consent_evidence_enqueue()'::regprocedure,
    'public.quarantine_audience_webhook(text,text,text,text,text,text,boolean)'::regprocedure,
    'public.reconcile_quarantined_audience_events(integer)'::regprocedure,
    'public.record_audience_provider_event(text,text,text,text,text,text,text,text,boolean)'::regprocedure,
    'public.record_audience_suppression(text,text,text)'::regprocedure,
    'public.record_profile_consent_evidence()'::regprocedure
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_proc p,
             unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS setting
       WHERE p.oid = v_function
         AND setting = 'search_path=public, extensions'
    ) THEN
      RAISE EXCEPTION 'safe pgcrypto search_path missing for %', v_function;
    END IF;
  END LOOP;
END;
$function$;

COMMIT;
