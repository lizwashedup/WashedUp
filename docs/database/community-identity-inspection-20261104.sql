-- Read-only inspection after native QA found permission denied on name/purpose.
SELECT 'table' AS kind, jsonb_build_object('rls',relrowsecurity,'force_rls',relforcerowsecurity,'acl',relacl)::text AS payload
FROM pg_class WHERE oid='public.communities'::regclass
UNION ALL
SELECT 'column',jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'acl',a.attacl,
 'authenticated_update',has_column_privilege('authenticated','public.communities',a.attname,'UPDATE'),
 'anon_update',has_column_privilege('anon','public.communities',a.attname,'UPDATE'))::text
FROM pg_attribute a WHERE a.attrelid='public.communities'::regclass AND a.attnum>0 AND NOT a.attisdropped
UNION ALL
SELECT 'policy',to_jsonb(p)::text FROM pg_policies p WHERE schemaname='public' AND tablename='communities'
UNION ALL
SELECT 'trigger',jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,
 'routine',t.tgfoid::regprocedure::text,'function_definition',pg_get_functiondef(t.tgfoid))::text
FROM pg_trigger t WHERE t.tgrelid='public.communities'::regclass AND NOT t.tgisinternal
UNION ALL
SELECT 'authority',jsonb_build_object('definition',pg_get_functiondef('public.is_community_leader(uuid,uuid)'::regprocedure),
 'md5',md5(pg_get_functiondef('public.is_community_leader(uuid,uuid)'::regprocedure)))::text
UNION ALL
SELECT 'qa',jsonb_build_object('id',id,'name',name,'purpose',purpose,'status',status,'discoverable',discoverable,
 'join_policy',join_policy,'active_members',(SELECT count(*) FROM public.community_members m WHERE m.community_id=c.id AND m.status='active'))::text
FROM public.communities c WHERE id='ed31b9f3-2b78-4690-88b2-c05b74265a11'
UNION ALL
SELECT 'constraint',jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid))::text
FROM pg_constraint WHERE conrelid='public.communities'::regclass AND contype='c'
UNION ALL
SELECT 'helper',jsonb_build_object('name',proname,'signature',oid::regprocedure::text,'md5',md5(pg_get_functiondef(oid)),'definition',pg_get_functiondef(oid))::text
FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('is_community_member','creator_page_is_visible','creator_community_is_visible')
UNION ALL
SELECT 'policies_digest',jsonb_build_object('md5',md5(jsonb_agg(to_jsonb(p) ORDER BY policyname)::text))::text
FROM pg_policies p WHERE schemaname='public' AND tablename='communities'
ORDER BY kind,payload;
