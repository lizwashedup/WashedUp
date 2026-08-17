\set ON_ERROR_STOP on

DELETE FROM auth.users
WHERE id = '00000000-0000-0000-0000-000000000001';

DO $$
DECLARE
  target_rows integer;
  survivor_rows integer;
  missing_indexes text[];
BEGIN
  SELECT
    (SELECT count(*) FROM public.user_roles WHERE user_id = '00000000-0000-0000-0000-000000000001') +
    (SELECT count(*) FROM public.email_verification_codes WHERE user_id = '00000000-0000-0000-0000-000000000001') +
    (SELECT count(*) FROM public.sms_verification_codes WHERE user_id = '00000000-0000-0000-0000-000000000001')
  INTO target_rows;

  IF target_rows <> 0 THEN
    RAISE EXCEPTION 'account deletion contract failed: % target rows remain', target_rows;
  END IF;

  SELECT
    (SELECT count(*) FROM public.user_roles WHERE user_id = '00000000-0000-0000-0000-000000000002') +
    (SELECT count(*) FROM public.email_verification_codes WHERE user_id = '00000000-0000-0000-0000-000000000002') +
    (SELECT count(*) FROM public.sms_verification_codes WHERE user_id = '00000000-0000-0000-0000-000000000002')
  INTO survivor_rows;

  IF survivor_rows <> 3 THEN
    RAISE EXCEPTION 'account deletion contract failed: expected 3 survivor rows, got %', survivor_rows;
  END IF;

  SELECT array_agg(expected_name ORDER BY expected_name)
  INTO missing_indexes
  FROM (VALUES
    ('user_roles', 'user_id', 'user_roles_user_id_role_key'),
    ('email_verification_codes', 'user_id', 'email_verification_codes_user_id_idx'),
    ('sms_verification_codes', 'user_id', 'sms_verification_codes_user_id_idx')
  ) AS expected(table_name, column_name, expected_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_class table_rel
    JOIN pg_namespace table_ns ON table_ns.oid = table_rel.relnamespace
    JOIN pg_index idx ON idx.indrelid = table_rel.oid
    JOIN pg_class index_rel ON index_rel.oid = idx.indexrelid
    JOIN pg_attribute attr
      ON attr.attrelid = table_rel.oid
     AND attr.attnum = (idx.indkey::smallint[])[0]
    WHERE table_ns.nspname = 'public'
      AND table_rel.relname = expected.table_name
      AND index_rel.relname = expected.expected_name
      AND attr.attname = expected.column_name
  );

  IF missing_indexes IS NOT NULL THEN
    RAISE EXCEPTION 'account deletion contract failed: missing supporting indexes %', missing_indexes;
  END IF;
END $$;

SELECT 'PASS account deletion: three tracked cascades and their supporting indexes' AS result;
