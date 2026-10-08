-- READ ONLY: catalog metadata only; no member rows, messages, tokens or secrets.
-- Run against the intended WashedUp project after confirming its identity.
-- Review results before any promotion of the separate policy candidate.
SELECT 'rls' AS section, c.relname::text AS object_name,
  jsonb_build_object('enabled',c.relrowsecurity,'forced',c.relforcerowsecurity) AS details
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
  ('messages','message_reactions','circles','circle_members','profiles','user_blocks','push_registration_state')
UNION ALL
SELECT 'policy', p.tablename || '.' || p.policyname,
  jsonb_build_object('roles',p.roles,'command',p.cmd,'permissive',p.permissive,'using',p.qual,'check',p.with_check)
FROM pg_policies p WHERE p.schemaname='public' AND p.tablename IN
  ('messages','message_reactions','circles','circle_members','profiles','user_blocks','push_registration_state')
UNION ALL
SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
  jsonb_build_object('security_definer',p.prosecdef,'configuration',p.proconfig,
    'definition_md5',md5(pg_get_functiondef(p.oid)), 'definition',pg_get_functiondef(p.oid),
    'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'anonymous_execute',has_function_privilege('anon',p.oid,'EXECUTE'))
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
  ('yours_is_blocked_between','get_or_create_dm','get_circle','get_circle_chat_messages',
   'get_my_circle_chat_cards','get_person_profile','is_circle_member','private_chat_contact_allowed',
   'record_push_registration_state','edit_own_chat_message','edit_own_chat_message_with_mentions')
UNION ALL
SELECT 'column', c.table_name || '.' || c.column_name,
  jsonb_build_object('data_type',c.data_type,'udt_name',c.udt_name,'nullable',c.is_nullable)
FROM information_schema.columns c WHERE c.table_schema='public' AND
  ((c.table_name='profiles' AND c.column_name='blocked_users') OR c.table_name='user_blocks')
ORDER BY section, object_name;
