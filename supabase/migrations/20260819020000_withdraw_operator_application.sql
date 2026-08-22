-- ============================================================================
-- self-withdraw for a pending operator application (inventory S-01).
--
-- operator_grants has no self-UPDATE policy today (operator_grants_update
-- only allows admins) -- this RPC is the one door: a user can withdraw ONLY
-- their own row, and ONLY while it has not yet been decided. A
-- decided (approved/declined) or already-revoked/withdrawn row cannot be
-- touched this way.
--
-- ADDITIVE ONLY. NOT applied anywhere -- written 2026-08-19. Depends on
-- 20260819010000 (the 'withdrawn' enum value) applying first.
-- ============================================================================

begin;

create or replace function public.withdraw_operator_application(p_grant_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_status public.operator_grant_status;
  v_owner uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select status, user_id into v_status, v_owner
  from operator_grants where id = p_grant_id;

  if v_owner is null then
    raise exception 'Application not found';
  end if;
  if v_owner <> v_uid then
    raise exception 'Not your application';
  end if;
  if v_status not in ('applied', 'in_review', 'needs_more_info') then
    raise exception 'This application can no longer be withdrawn';
  end if;

  update operator_grants set status = 'withdrawn' where id = p_grant_id;
end;
$$;

revoke all on function public.withdraw_operator_application(uuid) from public, anon;
grant execute on function public.withdraw_operator_application(uuid) to authenticated;

commit;
