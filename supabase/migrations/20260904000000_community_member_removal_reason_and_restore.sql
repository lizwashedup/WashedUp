-- DRAFT: DO NOT APPLY WITHOUT JOSH'S WORD.
-- ============================================================================
-- Liz decision #10, 2026-09-03 (WashedUp_Responses_to_Josh_21_Decisions):
-- "When a community leader removes someone, require a recorded reason and
-- allow the leader to undo the removal. Keep serious platform-level bans
-- separate as a WashedUp safety action." Full context:
-- clients/washed-up/LIZ-OPEN-QUESTIONS.md item 10.
--
-- Additive and reversible: adds three nullable columns to community_members
-- and two new leader-gated RPCs. The existing client-side removeMember()
-- (lib/creatorMode.ts) is untouched and keeps working exactly as it does
-- today -- these RPCs are a separate, additive path that only the app code
-- gated behind MEMBER_REMOVAL_REASON_ENABLED (constants/FeatureFlags.ts)
-- calls. Do not flip that flag on for a real build until this migration is
-- reviewed and applied to prod.
--
-- restore_community_member() deliberately only reverses a leader-initiated
-- 'removed' row, never a 'banned' one -- Liz was explicit that the app-wide
-- ban tier for real platform abuse stays a separate action with its own
-- appeal path (hello@washedup.app), not something a community leader can
-- silently undo from this screen.
-- ============================================================================

alter table public.community_members
  add column if not exists removed_reason text,
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references auth.users(id);

-- ---------------------------------------------------------------------------
-- remove_community_member: same guard as the existing client-side
-- removeMember() (active + role='member' only, never removes a leader row
-- this way), now requires and records a reason plus who/when.
-- ---------------------------------------------------------------------------
create or replace function public.remove_community_member(
  p_member_id uuid,
  p_reason text
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select id, community_id, status, role into v_row
  from community_members where id = p_member_id;
  if v_row.id is null then
    raise exception 'That member is gone.';
  end if;
  if not (is_community_leader(v_row.community_id, v_uid)
          or is_admin(v_uid) or has_role(v_uid, 'admin'::app_role)) then
    raise exception 'Not authorized';
  end if;
  if v_row.status <> 'active' or v_row.role <> 'member' then
    raise exception 'Could not remove that member.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required.';
  end if;

  update community_members
  set status = 'removed',
      role = 'member',
      removed_reason = btrim(p_reason),
      removed_at = now(),
      removed_by = v_uid
  where id = p_member_id;
end;
$$;

revoke all on function public.remove_community_member(uuid, text) from public;
revoke all on function public.remove_community_member(uuid, text) from anon;
grant execute on function public.remove_community_member(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- restore_community_member: reverses a leader-initiated removal only.
-- ---------------------------------------------------------------------------
create or replace function public.restore_community_member(
  p_member_id uuid
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select id, community_id, status into v_row
  from community_members where id = p_member_id;
  if v_row.id is null then
    raise exception 'That member is gone.';
  end if;
  if not (is_community_leader(v_row.community_id, v_uid)
          or is_admin(v_uid) or has_role(v_uid, 'admin'::app_role)) then
    raise exception 'Not authorized';
  end if;
  if v_row.status <> 'removed' then
    raise exception 'That member cannot be restored from here.';
  end if;

  update community_members
  set status = 'active',
      removed_reason = null,
      removed_at = null,
      removed_by = null
  where id = p_member_id;
end;
$$;

revoke all on function public.restore_community_member(uuid) from public;
revoke all on function public.restore_community_member(uuid) from anon;
grant execute on function public.restore_community_member(uuid) to authenticated;

-- No self-test block: this sandbox has no live Postgres to run one against
-- (same limitation noted in 20260901020000's header). Needs a real
-- local/staging pass -- create a member, remove with a reason, confirm the
-- reason/timestamp/actor land, restore, confirm status returns to 'active'
-- and the three columns clear, and confirm a 'banned' row is refused by
-- restore_community_member -- before this is reviewed for prod.
