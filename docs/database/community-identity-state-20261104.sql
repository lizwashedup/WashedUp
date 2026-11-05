-- Read-only pre/post-deployment and QA state. No profile content or credentials.
SELECT jsonb_build_object(
 'community_count',(SELECT count(*) FROM public.communities),
 'community_digest',(SELECT md5(string_agg(to_jsonb(c)::text,',' ORDER BY id)) FROM public.communities c),
 'other_community_digest',(SELECT md5(string_agg(to_jsonb(c)::text,',' ORDER BY id)) FROM public.communities c WHERE id<>'ed31b9f3-2b78-4690-88b2-c05b74265a11'),
 'member_count',(SELECT count(*) FROM public.community_members),
 'member_digest',(SELECT md5(string_agg(to_jsonb(m)::text,',' ORDER BY id)) FROM public.community_members m),
 'policies_digest',(SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY policyname)::text) FROM pg_policies p WHERE schemaname='public' AND tablename='communities'),
 'routines_digest',(SELECT md5(string_agg(oid::regprocedure::text||pg_get_functiondef(oid),',' ORDER BY oid::regprocedure::text)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f' AND (proname LIKE '%community%' OR proname LIKE 'creator_page_%')),
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',attname,'acl',attacl) ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.communities'::regclass AND attnum>0 AND NOT attisdropped),
 'table',(SELECT jsonb_build_object('rls',relrowsecurity,'force_rls',relforcerowsecurity,'acl',relacl) FROM pg_class WHERE oid='public.communities'::regclass),
 'purpose_update',has_column_privilege('authenticated','public.communities','purpose','UPDATE'),
 'anon_purpose_update',has_column_privilege('anon','public.communities','purpose','UPDATE'),
 'qa',(SELECT jsonb_build_object('id',id,'name',name,'purpose',purpose,'status',status,'discoverable',discoverable,'join_policy',join_policy,
  'unchanged_fields_digest',md5((to_jsonb(c)-'name'-'purpose'-'updated_at')::text)) FROM public.communities c WHERE id='ed31b9f3-2b78-4690-88b2-c05b74265a11')
) AS state;
