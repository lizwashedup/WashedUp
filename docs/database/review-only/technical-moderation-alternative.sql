-- CONTINGENT PRODUCT ALTERNATIVE. REVIEW ONLY. DO NOT APPLY.
--
-- This preserves a tested technical shape for hardening the current automatic
-- report restriction only if Liz explicitly chooses to retain automatic
-- enforcement. The threshold, eligible report classes, restriction duration,
-- and automatic-versus-review decision are product and moderation policy.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.reports') IS NULL
     OR to_regclass('public.moderation_actions') IS NULL
     OR to_regclass('auth.users') IS NULL
     OR to_regclass('auth.sessions') IS NULL
     OR to_regclass('auth.refresh_tokens') IS NULL THEN
    RAISE EXCEPTION 'moderation alternative preflight failed';
  END IF;
END;
$preflight$;

CREATE TABLE public.moderation_automation_failures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation text NOT NULL,
  target_user_id uuid,
  error_code text NOT NULL,
  error_message text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.moderation_automation_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moderation_automation_failures FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.moderation_automation_failures TO service_role;

CREATE OR REPLACE FUNCTION public.auto_ban_reported_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  report_count integer;
BEGIN
  IF new.reported_user_id IS NULL
     OR new.reporter_user_id IS NOT DISTINCT FROM new.reported_user_id
     OR new.reason IS NOT DISTINCT FROM 'Blocked by user' THEN
    RETURN new;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.reported_user_id::text, 3003)
  );

  SELECT count(DISTINCT r.reporter_user_id)::integer INTO report_count
  FROM public.reports r
  WHERE r.reported_user_id = new.reported_user_id
    AND r.reporter_user_id IS DISTINCT FROM r.reported_user_id
    AND r.reason IS DISTINCT FROM 'Blocked by user';

  IF report_count >= 3 THEN
    UPDATE auth.users
       SET banned_until = greatest(
         coalesce(banned_until, '-infinity'::timestamptz),
         '2099-01-01 00:00:00+00'::timestamptz
       )
     WHERE id = new.reported_user_id;

    DELETE FROM auth.refresh_tokens WHERE user_id = new.reported_user_id::text;
    DELETE FROM auth.sessions WHERE user_id = new.reported_user_id;

    IF NOT EXISTS (
      SELECT 1 FROM public.moderation_actions ma
      WHERE ma.target_user_id = new.reported_user_id
        AND ma.action = 'auto_ban'
        AND ma.metadata @> '{"policy_version":"three_distinct_reporters_v1"}'::jsonb
    ) THEN
      INSERT INTO public.moderation_actions (
        action, target_user_id, reason, performed_by, metadata
      ) VALUES (
        'auto_ban', new.reported_user_id,
        'Automated report threshold reached', NULL,
        jsonb_build_object(
          'policy_version', 'three_distinct_reporters_v1',
          'distinct_reporter_count', report_count
        )
      );
    END IF;
  END IF;

  RETURN new;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.moderation_automation_failures (
    operation, target_user_id, error_code, error_message
  ) VALUES (
    'auto_ban_reported_user', new.reported_user_id,
    SQLSTATE, left(SQLERRM, 500)
  );
  RETURN new;
END;
$function$;

ALTER FUNCTION public.auto_ban_reported_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.auto_ban_reported_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_ban_reported_user() TO service_role;

COMMIT;
