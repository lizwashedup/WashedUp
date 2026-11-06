-- Read-only catalog inspection. No application rows or credentials.
SELECT kind, value FROM (
  SELECT 'routine'::text kind, jsonb_build_object('name',p.proname,'identity',p.oid::regprocedure::text,
    'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid)),
    'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'security_definer',p.prosecdef,'config',p.proconfig) value
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname IN (
    'operator_create_explore_event','operator_create_explore_event_with_categories',
    'operator_update_explore_event','operator_update_explore_event_with_categories',
    'operator_set_event_offer_type','operator_set_event_ticket_capacity','operator_set_event_coordinates',
    'can_manage_community_events','can_manage_event','is_community_leader','is_platform_admin',
    'creator_event_page_id','creator_page_team_event_can_manage','has_operator_grant','creator_event_owner_is_eligible','creator_community_is_visible','creator_page_is_visible','creator_page_audience_matches','is_admin','has_role','operator_set_explore_event_coords',
    'create_creator_page_event_draft','create_creator_page_event_draft_with_categories')
    OR p.proname LIKE '%event%categor%')
  UNION ALL
  SELECT 'column',jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'required',a.attnotnull,
    'default',pg_get_expr(d.adbin,d.adrelid),'generated',a.attgenerated,'acl',a.attacl)
  FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid='public.explore_events'::regclass AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraint',jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid))
  FROM pg_constraint WHERE conrelid='public.explore_events'::regclass
  UNION ALL
  SELECT 'trigger',jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid),'routine',t.tgfoid::regprocedure::text,
    'function_definition',pg_get_functiondef(t.tgfoid))
  FROM pg_trigger t WHERE t.tgrelid='public.explore_events'::regclass AND NOT t.tgisinternal
  UNION ALL
  SELECT 'policy',to_jsonb(p) FROM pg_policies p WHERE schemaname='public' AND tablename='explore_events'
  UNION ALL
  SELECT 'enum',jsonb_build_object('name',t.typname,'labels',jsonb_agg(e.enumlabel ORDER BY e.enumsortorder))
  FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
  WHERE n.nspname='public' AND t.typname IN ('operator_track','event_offer_type','app_role') GROUP BY t.typname
  UNION ALL
  SELECT 'table',jsonb_build_object('acl',relacl,'rls',relrowsecurity,'force_rls',relforcerowsecurity)
  FROM pg_class WHERE oid='public.explore_events'::regclass
) catalog ORDER BY kind,value->>'name';
