\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.pre_default_postgres()', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.pre_default_postgres()', 'EXECUTE')
    OR NOT has_function_privilege('anon', 'public.pre_default_admin()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'default privilege contract failed: existing ACLs changed';
  END IF;
END $$;

CREATE FUNCTION public.post_default_postgres() RETURNS text
LANGUAGE sql AS $$ SELECT 'post'::text $$;

SET ROLE supabase_admin;
CREATE FUNCTION public.post_default_admin() RETURNS text
LANGUAGE sql AS $$ SELECT 'post'::text $$;
RESET ROLE;

DO $$
DECLARE
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'public.post_default_postgres()',
    'public.post_default_admin()'
  ]
  LOOP
    IF has_function_privilege('anon', function_name, 'EXECUTE')
      OR has_function_privilege('authenticated', function_name, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'default privilege contract failed: untrusted execute on %', function_name;
    END IF;
    IF NOT has_function_privilege('service_role', function_name, 'EXECUTE') THEN
      RAISE EXCEPTION 'default privilege contract failed: service role cannot execute %', function_name;
    END IF;
  END LOOP;
END $$;

SELECT 'PASS default function privileges: old ACLs retained, future functions fail closed' AS result;
