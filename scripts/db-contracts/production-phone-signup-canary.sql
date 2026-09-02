-- Production-safe structural canary for the auth signup trigger chain.
-- Every write is rolled back. The fixed UUID and reserved 202-555 number make
-- collisions fail closed instead of touching an existing account.

BEGIN;

INSERT INTO auth.users(id, phone)
VALUES ('14000000-0000-4000-8000-000000000099', '12025550199');

DO $canary$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = '14000000-0000-4000-8000-000000000099'::uuid
       AND email IS NULL
       AND phone_number = '12025550199'
  ) THEN
    RAISE EXCEPTION 'signup profile trigger failed';
  END IF;

  IF (
    SELECT count(*)
      FROM public.audience_consent_events
     WHERE profile_id = '14000000-0000-4000-8000-000000000099'::uuid
       AND email_hash IS NULL
       AND email_consent = false
  ) <> 1 THEN
    RAISE EXCEPTION 'signup consent trigger failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.audience_sync_outbox
     WHERE profile_id = '14000000-0000-4000-8000-000000000099'::uuid
  ) THEN
    RAISE EXCEPTION 'phone signup incorrectly queued audience work';
  END IF;
END;
$canary$;

ROLLBACK;

SELECT
  NOT EXISTS (
    SELECT 1 FROM auth.users
     WHERE id = '14000000-0000-4000-8000-000000000099'::uuid
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = '14000000-0000-4000-8000-000000000099'::uuid
  ) AS rollback_clean;
