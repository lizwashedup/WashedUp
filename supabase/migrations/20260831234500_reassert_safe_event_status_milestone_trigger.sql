-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
--
-- Forward-only repair for production trigger-body drift.
--
-- A guest taking the final spot changes events.status to full. The drifted
-- trigger called the creator-facing RPC under the guest's JWT, raised
-- "unauthorized", and rolled back the entire join_event_atomic transaction.
-- Keep the public RPC's self-check intact. Trigger context must call the
-- non-client-callable internal implementation directly.

begin;

do $preflight$
declare
  v_body text;
  v_body_lower text;
  v_trigger_owner text;
  v_trigger_security_definer boolean;
  v_helper_owner text;
  v_helper_security_definer boolean;
  v_helper_config text[];
begin
  if to_regprocedure('public._creator_milestones_apply(uuid)') is null then
    raise exception 'refusing repair: _creator_milestones_apply(uuid) is missing';
  end if;
  if to_regprocedure('public.trg_events_update_check_marks()') is null then
    raise exception 'refusing repair: trg_events_update_check_marks() is missing';
  end if;

  select pg_get_functiondef(p.oid), r.rolname, p.prosecdef
    into v_body, v_trigger_owner, v_trigger_security_definer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
   where n.nspname = 'public'
     and p.proname = 'trg_events_update_check_marks'
     and pg_get_function_identity_arguments(p.oid) = '';

  v_body_lower := lower(v_body);

  if v_trigger_owner <> 'postgres' or not v_trigger_security_definer then
    raise exception 'refusing repair: status trigger ownership/security posture is unexpected';
  end if;
  if position('old.status is distinct from new.status' in v_body_lower) = 0
     or position('return new' in v_body_lower) = 0
     or (length(v_body_lower) - length(replace(v_body_lower, 'perform', ''))) / length('perform') <> 1
     or not (
       (position('check_creator_milestones(new.creator_user_id)' in v_body_lower) > 0
        and position('_creator_milestones_apply(new.creator_user_id)' in v_body_lower) = 0)
       or
       (position('public._creator_milestones_apply(new.creator_user_id)' in v_body_lower) > 0
        and position('public.check_creator_milestones(new.creator_user_id)' in v_body_lower) = 0)
     ) then
    raise exception 'refusing repair: unexpected trg_events_update_check_marks body';
  end if;

  select r.rolname, p.prosecdef, p.proconfig
    into v_helper_owner, v_helper_security_definer, v_helper_config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
   where n.nspname = 'public'
     and p.proname = '_creator_milestones_apply'
     and pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid';

  if v_helper_owner <> 'postgres'
     or not v_helper_security_definer
     or not coalesce('search_path=public' = any(v_helper_config), false)
     or has_function_privilege('anon', 'public._creator_milestones_apply(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._creator_milestones_apply(uuid)', 'execute') then
    raise exception 'refusing repair: internal milestone helper security posture is unexpected';
  end if;
end;
$preflight$;

create or replace function public.trg_events_update_check_marks()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if OLD.status is distinct from NEW.status then
    perform public._creator_milestones_apply(NEW.creator_user_id);
  end if;
  return NEW;
end;
$function$;

revoke all on function public.trg_events_update_check_marks() from public, anon, authenticated;

do $verify$
declare
  v_body text;
  v_owner text;
  v_config text[];
begin
  select pg_get_functiondef(p.oid), r.rolname, p.proconfig
    into v_body, v_owner, v_config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
   where n.nspname = 'public'
     and p.proname = 'trg_events_update_check_marks'
     and pg_get_function_identity_arguments(p.oid) = '';

  if position('perform public._creator_milestones_apply(NEW.creator_user_id)' in v_body) = 0
     or position('perform public.check_creator_milestones' in v_body) > 0 then
    raise exception 'self-test failed: status trigger does not call only the internal milestone helper';
  end if;
  if v_owner <> 'postgres' then
    raise exception 'self-test failed: status trigger owner is %, expected postgres', v_owner;
  end if;
  if not ('search_path=public' = any(v_config)) then
    raise exception 'self-test failed: status trigger search_path is not fixed to public';
  end if;
  if has_function_privilege('anon', 'public._creator_milestones_apply(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._creator_milestones_apply(uuid)', 'execute') then
    raise exception 'self-test failed: internal milestone helper is client-callable';
  end if;
  if has_function_privilege('anon', 'public.trg_events_update_check_marks()', 'execute')
     or has_function_privilege('authenticated', 'public.trg_events_update_check_marks()', 'execute') then
    raise exception 'self-test failed: status trigger function is client-callable';
  end if;
  if (
    select count(*)
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'events'
       and t.tgname = 'trg_events_after_update_marks'
       and t.tgfoid = 'public.trg_events_update_check_marks()'::regprocedure
       and t.tgtype = 17
       and not t.tgisinternal
  ) <> 1 then
    raise exception 'self-test failed: expected AFTER UPDATE FOR EACH ROW events trigger attachment is missing or duplicated';
  end if;
end;
$verify$;

commit;
