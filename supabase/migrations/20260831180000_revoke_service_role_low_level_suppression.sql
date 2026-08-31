BEGIN;

REVOKE EXECUTE ON FUNCTION public.record_audience_suppression(text, text, text)
  FROM service_role;

COMMIT;
