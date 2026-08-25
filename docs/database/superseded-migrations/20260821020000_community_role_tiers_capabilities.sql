-- ARCHIVED. NON-EXECUTABLE. SECTION 7B DEPENDS ON THE SUPERSEDED ENUM CHAIN.
-- ============================================================================
-- S-03 co-creator role model, step 2 of 2: capability functions, RLS/RPC
-- reclassification, ownership-only role changes.
--
-- REVIEW ONLY. NOT applied anywhere. Must apply strictly AFTER
-- 20260821010000_community_role_tiers_enum.sql commits (this file's literals
-- 'admin' / 'events' / 'member_care' / 'finance' do not exist as valid enum
-- labels until that migration's own transaction has committed).
--
-- Spec source: WashedUp_Creator_Space_Complete_Inventory.md (Liz, 2026-08-18)
-- line 392-396. Full capability matrix and every call-site decision recorded
-- in the 2026-08-21 S-03 planning-pass handoff; only the two judgment calls
-- and the two fixes this file makes BEYOND that handoff's literal call-site
-- list are re-justified inline below (search "JUDGMENT CALL" / "FIX,
-- DISCOVERED BY READING THE CODE").
--
-- Targets three ALREADY-APPLIED-TO-PROD files that cannot be edited in
-- place (20260702184012_communities_skeleton.sql, applied 2026-07-02;
-- 20260706150000_mvp_batch.sql, applied 2026-07-06; 20260714223943's
-- proposal 42, applied 2026-07-14) via CREATE OR REPLACE FUNCTION / DROP+
-- CREATE POLICY, matching this repo's own established pattern for changing
-- an applied migration's behavior (e.g. 20260714223943 itself does exactly
-- this "drop policy if exists ... ; create policy ..." to answers_withhold's
-- own predecessor state).
--
-- is_community_leader() ITSELF IS NOT TOUCHED: it stays exactly
-- role IN ('leader','co_leader'), used only for genuine read-visibility
-- (community_blocks_select "leader sees drafts too", community_broadcasts
-- reply-moderation-adjacent reads that were never write gates, etc). It is
-- replaced only at the specific write-side and roster-visibility call sites
-- named below.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_community_leader(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'S-03 dependency missing: public.is_community_leader(uuid,uuid)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'community_member_role' AND e.enumlabel = 'events'
  ) THEN
    RAISE EXCEPTION 'S-03 dependency missing: community_member_role has no ''events'' label -- apply 20260821010000_community_role_tiers_enum.sql first, in its own transaction';
  END IF;
  IF to_regtype('public.community_join_policy') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'communities' AND column_name = 'join_policy'
     ) THEN
    RAISE EXCEPTION 'S-03 section 7b dependency missing: communities.join_policy (20260819050000_community_join_policy.sql) not present';
  END IF;
  IF to_regprocedure('public.request_community_join_follow_up(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'S-03 section 7b dependency missing: public.request_community_join_follow_up(uuid,text) (20260819060000_community_join_review_actions.sql) not present';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. capability functions. Same security-definer/probe-guard shape as
--    is_community_leader() (20260702184012, section 8): a caller only ever
--    gets a true answer about themself unless admin/service_role. The "+"
--    suffix in each name and in every comment below means "this tier and
--    every tier structurally above it (Admin, Owner)", never a sibling
--    narrow tier -- Events/Member care/Finance do not inherit each other.
-- ---------------------------------------------------------------------------

create or replace function public.is_community_owner(p_community_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select (
    p_user_id = auth.uid()
    or is_admin(auth.uid()) or has_role(auth.uid(), 'admin'::app_role)
    or auth.role() = 'service_role'
  )
  and exists (
    select 1 from community_members
    where community_id = p_community_id and user_id = p_user_id
      and status = 'active' and role = 'leader'
  );
$$;

-- Admin+. 'co_leader' and 'admin' are treated identically on purpose: 'admin'
-- is the forward-facing name for the same capability set co_leader always
-- had (see the enum migration's header). No row is ever migrated between them.
create or replace function public.is_community_admin_or_above(p_community_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select (
    p_user_id = auth.uid()
    or is_admin(auth.uid()) or has_role(auth.uid(), 'admin'::app_role)
    or auth.role() = 'service_role'
  )
  and exists (
    select 1 from community_members
    where community_id = p_community_id and user_id = p_user_id
      and status = 'active' and role in ('leader', 'co_leader', 'admin')
  );
$$;

-- Events+: event CRUD/publish, tickets, check-in, attendee lists.
create or replace function public.can_manage_community_events(p_community_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select (
    p_user_id = auth.uid()
    or is_admin(auth.uid()) or has_role(auth.uid(), 'admin'::app_role)
    or auth.role() = 'service_role'
  )
  and exists (
    select 1 from community_members
    where community_id = p_community_id and user_id = p_user_id
      and status = 'active' and role in ('leader', 'co_leader', 'admin', 'events')
  );
$$;

-- Member care+: join-door, roster + approve/decline/remove/ban, room
-- moderation (delete messages, remove from a topic). Doubles as the roster-
-- VISIBILITY gate (community_members_select below), not just a members-table
-- write gate -- Member care cannot approve/decline what it cannot see.
create or replace function public.can_manage_community_members(p_community_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select (
    p_user_id = auth.uid()
    or is_admin(auth.uid()) or has_role(auth.uid(), 'admin'::app_role)
    or auth.role() = 'service_role'
  )
  and exists (
    select 1 from community_members
    where community_id = p_community_id and user_id = p_user_id
      and status = 'active' and role in ('leader', 'co_leader', 'admin', 'member_care')
  );
$$;

-- Finance+: view balance/pending/next payout/commission ledger/refunds.
create or replace function public.can_manage_community_finance(p_community_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select (
    p_user_id = auth.uid()
    or is_admin(auth.uid()) or has_role(auth.uid(), 'admin'::app_role)
    or auth.role() = 'service_role'
  )
  and exists (
    select 1 from community_members
    where community_id = p_community_id and user_id = p_user_id
      and status = 'active' and role in ('leader', 'co_leader', 'admin', 'finance')
  );
$$;

revoke all on function public.is_community_owner(uuid, uuid) from public;
revoke all on function public.is_community_admin_or_above(uuid, uuid) from public;
revoke all on function public.can_manage_community_events(uuid, uuid) from public;
revoke all on function public.can_manage_community_members(uuid, uuid) from public;
revoke all on function public.can_manage_community_finance(uuid, uuid) from public;
grant execute on function public.is_community_owner(uuid, uuid) to authenticated, anon;
grant execute on function public.is_community_admin_or_above(uuid, uuid) to authenticated, anon;
grant execute on function public.can_manage_community_events(uuid, uuid) to authenticated, anon;
grant execute on function public.can_manage_community_members(uuid, uuid) to authenticated, anon;
grant execute on function public.can_manage_community_finance(uuid, uuid) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. set_community_member_role: Owner-only. Genuinely new -- today the only
--    way to change a co-creator's standing is remove-and-reinvite. Rejects
--    'leader' outright: ownership transfer is a separate, unbuilt RPC (see
--    the planning-pass handoff's "flagged for Josh/Liz" section), not a
--    value this function will ever accept. 'member' IS accepted (a full
--    demote to plain member without removing them from the community).
-- ---------------------------------------------------------------------------

create or replace function public.set_community_member_role(
  p_community_id uuid,
  p_user_id uuid,
  p_role public.community_member_role
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_community_owner(p_community_id, v_uid) then
    raise exception 'Community owner access required' using errcode = '42501';
  end if;
  if p_role = 'leader' then
    raise exception 'Ownership transfer is not available here' using errcode = '22023';
  end if;
  if p_user_id = v_uid then
    raise exception 'You cannot change your own role' using errcode = '22023';
  end if;

  update public.community_members
  set role = p_role
  where community_id = p_community_id
    and user_id = p_user_id
    and status = 'active';

  if not found then
    raise exception 'That member could not be found' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.set_community_member_role(uuid, uuid, public.community_member_role) from public;
revoke all on function public.set_community_member_role(uuid, uuid, public.community_member_role) from anon;
grant execute on function public.set_community_member_role(uuid, uuid, public.community_member_role) to authenticated;

-- Backstop for the RLS loosening in section 3 below: community_members_update
-- moves to Member care+ so approve/decline/remove/ban work for that tier via
-- a raw client UPDATE, but a role CHANGE riding that same raw UPDATE path
-- must stay Owner-only regardless of caller. Mirrors
-- community_members_identity_immutable's existing shape exactly (same file,
-- section 8) -- same trigger position, same plain (non-definer) style, since
-- it only ever calls other already-definer functions and auth.uid(), which
-- resolves to the real caller's identity even when reached from inside
-- set_community_member_role's own SECURITY DEFINER UPDATE above.
--
-- SECURITY FIX (found in adversarial review before this migration ever
-- applied): the owner-only check above is necessary but not sufficient.
-- Because the Owner always passes it trivially, an Owner could raw-UPDATE
-- ANY member's role straight to 'leader' -- a second active leader row --
-- through this exact path, completely bypassing set_community_member_role's
-- own explicit `if p_role = 'leader' then raise exception` rejection just
-- below. Ownership transfer is a separate, unbuilt RPC (see that function's
-- comment); nothing may grant 'leader' outside of create_community()'s
-- original INSERT until that RPC exists. So this trigger now rejects a
-- 'leader' target unconditionally, before the owner check even runs --
-- matching the RPC's own unconditional rule, not just the RPC's callers.
create or replace function public.community_members_role_change_owner_only()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role then
    if new.role = 'leader' then
      raise exception 'Ownership transfer is not available here' using errcode = '22023';
    end if;
    if not public.is_community_owner(new.community_id, auth.uid()) then
      raise exception 'only the community owner can change a member''s role';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists community_members_role_change_guard on public.community_members;
create trigger community_members_role_change_guard
  before update on public.community_members
  for each row execute function public.community_members_role_change_owner_only();

-- ---------------------------------------------------------------------------
-- 3. leave_community(): narrow the last-leader guard to role = 'leader' only
--    (was leader-or-co_leader). Only the Owner is unleavable; all four
--    narrower tiers, and Admin/co_leader, are free to leave at will. There is
--    at most one active 'leader' row per community today (create_community()
--    seats exactly one, ownership transfer is unbuilt), so "the last leader"
--    and "a leader" are the same condition -- the old "is there another
--    active leader/co_leader" exists-check is dropped, not just renamed.
-- ---------------------------------------------------------------------------

create or replace function public.leave_community(p_community_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.community_member_role;
begin
  select role into v_role from community_members
  where community_id = p_community_id and user_id = v_uid and status = 'active';

  if v_role is null then
    return;  -- not an active member, nothing to do
  end if;

  if v_role = 'leader'
     and exists (select 1 from communities c
                 where c.id = p_community_id and c.status <> 'archived') then
    raise exception 'You are the last leader of this community. Appoint a co-leader or archive it first.';
  end if;

  update community_members
  set status = 'left', role = 'member'
  where community_id = p_community_id
    and user_id = v_uid
    and status = 'active';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS reclassification on the 20260702184012 (applied 2026-07-02) tables.
--    DROP + CREATE per policy (that migration is live; ALTER POLICY would
--    work too, but DROP+CREATE matches this repo's own established pattern
--    for touching an applied policy, e.g. 20260714223943 proposal 42).
-- ---------------------------------------------------------------------------

-- communities_update -> Admin+ (community settings/publish is Admin's job;
-- Owner is a strict superset via is_community_admin_or_above).
drop policy if exists communities_update on public.communities;
create policy communities_update on public.communities
  for update using (
    is_community_admin_or_above(id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  )
  with check (
    is_community_admin_or_above(id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

-- community_members_select: WIDENED, not just reclassified. Member care must
-- see pending members to approve/decline them -- is_community_leader() alone
-- (Owner+Admin only) would silently block the exact capability section 1's
-- can_manage_community_members grants. can_manage_community_members is a
-- strict superset of is_community_leader's true cases, so this is a
-- replacement, not an additional OR-branch.
drop policy if exists community_members_select on public.community_members;
create policy community_members_select on public.community_members
  for select using (
    user_id = (select auth.uid())
    or (status = 'active' and is_community_member(community_id, (select auth.uid())))
    or can_manage_community_members(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

-- community_members_update -> Member care+ (join approve/remove/ban). Role
-- CHANGES riding this same UPDATE path stay Owner-only via the trigger in
-- section 2 above, regardless of who this RLS policy admits.
drop policy if exists community_members_update on public.community_members;
create policy community_members_update on public.community_members
  for update using (
    can_manage_community_members(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  )
  with check (
    can_manage_community_members(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

-- community_blocks: write policies -> Admin+ (page editing). Select stays on
-- is_community_leader (Owner+Admin see drafts/hidden blocks) -- Events/Member
-- care/Finance are not granted page-editing insider visibility in the matrix.
drop policy if exists community_blocks_insert on public.community_blocks;
create policy community_blocks_insert on public.community_blocks
  for insert with check (
    is_community_admin_or_above(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
drop policy if exists community_blocks_update on public.community_blocks;
create policy community_blocks_update on public.community_blocks
  for update using (
    is_community_admin_or_above(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  )
  with check (
    is_community_admin_or_above(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
drop policy if exists community_blocks_delete on public.community_blocks;
create policy community_blocks_delete on public.community_blocks
  for delete using (
    is_community_admin_or_above(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

-- community_broadcasts: write policies -> Admin+ (send/pin broadcasts is the
-- community's official voice). Select stays is_community_member, unchanged.
drop policy if exists community_broadcasts_insert on public.community_broadcasts;
create policy community_broadcasts_insert on public.community_broadcasts
  for insert with check (
    sender_id = (select auth.uid())
    and is_community_admin_or_above(community_id, (select auth.uid()))
  );
drop policy if exists community_broadcasts_update on public.community_broadcasts;
create policy community_broadcasts_update on public.community_broadcasts
  for update using (
    is_community_admin_or_above(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  )
  with check (
    is_community_admin_or_above(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
drop policy if exists community_broadcasts_delete on public.community_broadcasts;
create policy community_broadcasts_delete on public.community_broadcasts
  for delete using (
    is_community_admin_or_above(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

-- community_broadcast_replies_delete -> Member care+ (room moderation).
drop policy if exists community_broadcast_replies_delete on public.community_broadcast_replies;
create policy community_broadcast_replies_delete on public.community_broadcast_replies
  for delete using (
    sender_id = (select auth.uid())
    or exists (
      select 1 from community_broadcasts b
      where b.id = broadcast_id and can_manage_community_members(b.community_id, (select auth.uid()))
    )
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

-- community_topics: CREATE is Admin+ ("topic create" is explicitly on
-- Admin's row in the matrix). UPDATE/DELETE (archiving -- the only thing
-- either policy actually governs) is Member care+ ("persistent-room
-- moderation"); Admin/Owner keep it too via is_community_admin_or_above
-- being a subset of can_manage_community_members's role list.
drop policy if exists community_topics_insert on public.community_topics;
create policy community_topics_insert on public.community_topics
  for insert with check (
    created_by = (select auth.uid())
    and is_community_admin_or_above(community_id, (select auth.uid()))
  );
drop policy if exists community_topics_update on public.community_topics;
create policy community_topics_update on public.community_topics
  for update using (
    can_manage_community_members(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  )
  with check (
    can_manage_community_members(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
drop policy if exists community_topics_delete on public.community_topics;
create policy community_topics_delete on public.community_topics
  for delete using (
    can_manage_community_members(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

-- community_topic_members_delete -> Member care+ ("remove from topic").
drop policy if exists community_topic_members_delete on public.community_topic_members;
create policy community_topic_members_delete on public.community_topic_members
  for delete using (
    user_id = (select auth.uid())
    or exists (
      select 1 from community_topics t
      where t.id = topic_id and can_manage_community_members(t.community_id, (select auth.uid()))
    )
  );

-- community_topic_messages_delete -> Member care+ ("delete messages").
drop policy if exists community_topic_messages_delete on public.community_topic_messages;
create policy community_topic_messages_delete on public.community_topic_messages
  for delete using (
    sender_id = (select auth.uid())
    or exists (
      select 1 from community_topics t
      where t.id = topic_id and can_manage_community_members(t.community_id, (select auth.uid()))
    )
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 5. FIX, DISCOVERED BY READING THE CODE (beyond the handoff's literal
--    call-site list, verified necessary by reading the actual downstream
--    consumers, not guessed): the Events tier's "attendee lists" capability
--    is entirely unreachable without this. Both native
--    ((creator)/attendees.tsx, tickets.tsx, check-in.tsx, event-form.tsx via
--    getCreatorEvents/getEventAttendees) and web (event-tickets/page.tsx,
--    attendees/page.tsx + its export route, via organizerData.ts's
--    getEventAttendeeData) resolve their OWN authorization entirely through
--    whether the underlying explore_events / explore_event_rsvps row is
--    even VISIBLE under RLS for a non-owner. That visibility today is
--    is_community_leader-gated (Owner+Admin only) on both policies below --
--    an Events-tier co-creator viewing a teammate's event (not their own
--    host_user_id) would get zero rows and read as "not authorized" on
--    every one of those six screens despite the matrix explicitly granting
--    Events tier this exact capability. Same 20260706150000_mvp_batch.sql
--    (applied 2026-07-06) as section 6 below; DROP+CREATE, not edited in
--    place.
-- ---------------------------------------------------------------------------

drop policy if exists "Operators can view own explore events" on public.explore_events;
create policy "Operators can view own explore events"
  on public.explore_events for select
  using (
    host_user_id = (select auth.uid())
    or (community_id is not null and can_manage_community_events(community_id, (select auth.uid())))
  );

drop policy if exists explore_event_rsvps_select on public.explore_event_rsvps;
create policy explore_event_rsvps_select
  on public.explore_event_rsvps for select
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from explore_events e
      where e.id = explore_event_id
        and (e.host_user_id = (select auth.uid())
             or (e.community_id is not null and can_manage_community_events(e.community_id, (select auth.uid()))))
    )
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 6. mvp_batch.sql (applied 2026-07-06) function reclassification: the
--    event-CRUD is_community_leader checks -> Events+. All three verbs the
--    matrix bundles for Events tier ("create/edit/publish") live in these
--    three functions -- create, update, and the "tell your members" publish
--    announce -- so all three move together, not just the one the handoff
--    pointed at (its own "~line 483" locator was inside
--    notify_community_event specifically; operator_create_explore_event and
--    operator_update_explore_event carry the identical shape of check and
--    would otherwise leave Events tier able to publish an event it could
--    never create or edit). CREATE OR REPLACE, identical signature, only the
--    authorization check's function name changes.
-- ---------------------------------------------------------------------------

create or replace function public.operator_create_explore_event(
  p_title text,
  p_description text default null,
  p_image_url text default null,
  p_event_date text default null,
  p_start_time timestamptz default null,
  p_venue text default null,
  p_venue_address text default null,
  p_category text default null,
  p_external_url text default null,
  p_ticket_price text default null,
  p_community_id uuid default null,
  p_public_name text default null
)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_operator_grant(v_uid, 'event_host'::operator_track)
          or has_operator_grant(v_uid, 'community_leader'::operator_track)) then
    raise exception 'Not authorized';
  end if;
  if coalesce(btrim(p_title), '') = '' or char_length(p_title) > 120 then
    raise exception 'A title is required.';
  end if;
  -- attribution: Events+ of that community can post as it (was: leader-only)
  if p_community_id is not null
     and not can_manage_community_events(p_community_id, v_uid) then
    raise exception 'Not authorized for that community';
  end if;

  insert into explore_events (
    title, description, image_url, event_date, start_time, venue,
    venue_address, category, external_url, ticket_price,
    host_user_id, community_id, public_name, status
  ) values (
    btrim(p_title),
    nullif(btrim(p_description), ''),
    nullif(btrim(p_image_url), ''),
    nullif(btrim(p_event_date), '')::date,
    p_start_time,
    nullif(btrim(p_venue), ''),
    nullif(btrim(p_venue_address), ''),
    nullif(btrim(p_category), ''),
    nullif(btrim(p_external_url), ''),
    nullif(btrim(p_ticket_price), '')::numeric,
    v_uid,
    p_community_id,
    nullif(btrim(p_public_name), ''),
    'Live'
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.operator_update_explore_event(
  p_event_id uuid,
  p_title text,
  p_description text default null,
  p_image_url text default null,
  p_event_date text default null,
  p_start_time timestamptz default null,
  p_venue text default null,
  p_venue_address text default null,
  p_category text default null,
  p_external_url text default null,
  p_ticket_price text default null,
  p_public_name text default null,
  p_status text default null
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
  select id, host_user_id, community_id into v_row
  from explore_events where id = p_event_id;
  if v_row.id is null then
    raise exception 'Event not found';
  end if;
  if not (v_row.host_user_id = v_uid
          or (v_row.community_id is not null and can_manage_community_events(v_row.community_id, v_uid))) then
    raise exception 'Not authorized';
  end if;
  if coalesce(btrim(p_title), '') = '' or char_length(p_title) > 120 then
    raise exception 'A title is required.';
  end if;
  if p_status is not null and p_status not in ('Live', 'Completed', 'Cancelled') then
    raise exception 'Invalid status';
  end if;

  update explore_events set
    title = btrim(p_title),
    description = nullif(btrim(p_description), ''),
    image_url = nullif(btrim(p_image_url), ''),
    event_date = nullif(btrim(p_event_date), '')::date,
    start_time = p_start_time,
    venue = nullif(btrim(p_venue), ''),
    venue_address = nullif(btrim(p_venue_address), ''),
    category = nullif(btrim(p_category), ''),
    external_url = nullif(btrim(p_external_url), ''),
    ticket_price = nullif(btrim(p_ticket_price), '')::numeric,
    public_name = nullif(btrim(p_public_name), ''),
    status = coalesce(p_status, status),
    updated_at = now()
  where id = p_event_id;
end;
$$;

create or replace function public.notify_community_event(p_event_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_event record;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select id, title, community_id, status, members_notified_at into v_event
  from explore_events where id = p_event_id;
  if v_event.id is null or v_event.community_id is null then
    raise exception 'Not a community event';
  end if;
  if not can_manage_community_events(v_event.community_id, v_uid) then
    raise exception 'Not authorized';
  end if;
  if v_event.status <> 'Live' then
    raise exception 'Only a live event can be announced.';
  end if;
  if v_event.members_notified_at is not null then
    raise exception 'Your members already heard about this one.';
  end if;

  update explore_events set members_notified_at = now() where id = p_event_id;

  select name into v_name from communities where id = v_event.community_id;
  insert into app_notifications (user_id, type, title, body, actor_user_id)
  select m.user_id,
         'community_event',
         v_name,
         'just posted ' || v_event.title || '.',
         v_uid
  from community_members m
  where m.community_id = v_event.community_id
    and m.status = 'active'
    and not m.broadcasts_muted
    and m.user_id is distinct from v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. proposal 42 (20260714223943, applied 2026-07-14): the join-answer
--    projection -> Member care+ (roster review needs the answers card, same
--    reasoning as community_members_select above).
-- ---------------------------------------------------------------------------

create or replace function public.get_join_answer_cards(
  p_community_id uuid
)
returns table (
  member_id uuid,
  first_name text,
  last_name text,
  area text,
  intro_answer text,
  guidelines_accepted_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not can_manage_community_members(p_community_id, auth.uid()) then
    raise exception 'Not authorized';
  end if;
  return query
  select
    a.member_id,
    a.answers->>'first_name',
    a.answers->>'last_name',
    za.area,
    a.answers->>'intro_answer',
    (a.answers->>'guidelines_accepted_at')::timestamptz
  from community_member_answers a
  left join zip_areas za on za.zip = a.answers->>'zip'
  where a.community_id = p_community_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7b. Two NOT-yet-applied sibling migrations
--     (20260819050000_community_join_policy.sql,
--     20260819060000_community_join_review_actions.sql) also gate on
--     is_community_leader for what the matrix calls Member care's
--     "join-door settings" and "roster + approve/decline + remove/ban".
--     Their own files carry a documentation-only note pointing here; the
--     actual swap has to live in THIS migration (not theirs) because
--     can_manage_community_members does not exist yet at their position in
--     the migration sequence (2026-08-19, before this file). CREATE OR
--     REPLACE, identical signatures, only the authorization check's function
--     name changes -- the request_community_join_follow_up widening to
--     Member care+ is a judgment call beyond that handoff's literal
--     three-function list (set_community_join_policy, review_community_join,
--     get_join_answer_cards), made for consistency: it is the same join-
--     review flow's third action (ask a follow-up before deciding), and
--     leaving it Owner+Admin-only while its two siblings move to Member
--     care+ would let Member care approve/decline a request but not ask it
--     a clarifying question first.
-- ---------------------------------------------------------------------------

create or replace function public.set_community_join_policy(
  p_community_id uuid,
  p_join_policy public.community_join_policy
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_found uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (
    public.can_manage_community_members(p_community_id, v_uid)
    or public.is_admin(v_uid) or public.has_role(v_uid, 'admin'::public.app_role)
  ) then
    raise exception 'Leader access required';
  end if;

  perform set_config('washedup.allow_join_policy_write', 'true', true);
  update public.communities set join_policy = p_join_policy where id = p_community_id
  returning id into v_found;

  if v_found is null then
    raise exception 'Community not found';
  end if;
end;
$$;

create or replace function public.review_community_join(
  p_member_id uuid,
  p_approve boolean,
  p_applicant_message text default null
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_community_name text;
  v_topic_id uuid;
  v_intro text;
  v_message text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select id, community_id, user_id, status into v_row
  from community_members where id = p_member_id;
  if v_row.id is null then
    raise exception 'That request is gone.';
  end if;
  if not (can_manage_community_members(v_row.community_id, v_uid)
          or is_admin(v_uid) or has_role(v_uid, 'admin'::app_role)) then
    raise exception 'Not authorized';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'That request was already handled.';
  end if;

  select name into v_community_name from communities where id = v_row.community_id;

  if not p_approve then
    v_message := nullif(btrim(coalesce(p_applicant_message, '')), '');
    if v_message is not null and char_length(v_message) > 500 then
      raise exception 'Keep the note under 500 characters.';
    end if;
    update community_members set status = 'declined' where id = v_row.id;
    insert into app_notifications (user_id, type, title, body, actor_user_id)
    values (
      v_row.user_id,
      'community_join_declined',
      'about your request',
      coalesce(v_message, 'not this time, and that''s okay. there are more communities to find.'),
      v_uid
    );
    return;
  end if;

  update community_members
  set status = 'active', joined_at = now()
  where id = v_row.id;

  select id into v_topic_id
  from community_topics
  where community_id = v_row.community_id and is_default and not archived;
  if v_topic_id is null then
    begin
      insert into community_topics (community_id, name, created_by, is_default)
      values (v_row.community_id, 'introductions', v_uid, true)
      returning id into v_topic_id;
    exception when unique_violation then
      select id into v_topic_id
      from community_topics
      where community_id = v_row.community_id and is_default and not archived;
    end;
  end if;

  insert into community_topic_members (topic_id, user_id)
  values (v_topic_id, v_row.user_id)
  on conflict (topic_id, user_id) do nothing;

  select btrim(coalesce(a.answers->>'intro_answer', '')) into v_intro
  from community_member_answers a where a.member_id = v_row.id;
  if coalesce(v_intro, '') <> '' then
    insert into community_topic_messages (topic_id, sender_id, body)
    values (v_topic_id, v_row.user_id, v_intro);
  end if;

  insert into app_notifications (user_id, type, title, body, actor_user_id)
  values (
    v_row.user_id,
    'community_join_approved',
    'you''re in',
    v_community_name || ' let you in. your introduction is already posted, come say hi.',
    v_uid
  );
end;
$$;

create or replace function public.request_community_join_follow_up(
  p_member_id uuid,
  p_message text
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_community_name text;
  v_message text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select id, community_id, user_id, status into v_row
  from community_members where id = p_member_id;
  if v_row.id is null then
    raise exception 'That request is gone.';
  end if;
  if not (can_manage_community_members(v_row.community_id, v_uid)
          or is_admin(v_uid) or has_role(v_uid, 'admin'::app_role)) then
    raise exception 'Not authorized';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'That request was already handled.';
  end if;

  v_message := btrim(coalesce(p_message, ''));
  if v_message = '' or char_length(v_message) > 500 then
    raise exception 'A short follow-up question is required.';
  end if;

  select name into v_community_name from communities where id = v_row.community_id;

  insert into app_notifications (user_id, type, title, body, actor_user_id)
  values (
    v_row.user_id,
    'community_join_follow_up',
    'one more thing',
    v_community_name || ' has a quick follow-up before deciding: ' || v_message,
    v_uid
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. in-transaction self-test (SELFTEST_ROLLBACK pattern, never strip on
--    apply). Seats one Owner + one row per new tier on a fresh self-test
--    community, then proves: each can_manage_* boundary (positive for its
--    own tier+above, negative for the others), set_community_member_role's
--    owner-only gate + leader-rejection + self-role-change rejection, the
--    role-change trigger blocking a raw non-owner UPDATE even when
--    community_members_update's own RLS would otherwise admit the caller
--    (Member care changing status is fine, changing role is not),
--    leave_community narrowed to leader-only, and (case 7) that same trigger
--    also blocks the OWNER's own raw UPDATE from minting a second 'leader'
--    row -- owner-only is necessary but was not sufficient on its own.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_owner       uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';  -- Liz
  v_admin       uuid := 'cafe0001-0000-0000-0000-000000000001';  -- Sage
  v_events      uuid := 'cafe0002-0000-0000-0000-000000000002';
  v_outsider    uuid;
  v_cid         uuid;
  v_raised      boolean;
BEGIN
  IF v_owner IS NULL OR v_admin IS NULL OR v_events IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_owner)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_admin)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_events) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: needs the seeded fixture users (Liz/Sage/cafe0002) to run';
  END IF;
  SELECT id INTO v_outsider FROM auth.users u
  WHERE u.id NOT IN (v_owner, v_admin, v_events)
    AND NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = u.id)
    AND NOT public.has_role(u.id, 'admin'::app_role)
  ORDER BY created_at LIMIT 1;
  IF v_outsider IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: needs a fourth non-admin user as the outsider';
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    v_cid := public.create_community('selftest-role-tiers-tmp', 'Self Test Role Tiers');

    INSERT INTO public.community_members (community_id, user_id, role, status, joined_at)
    VALUES (v_cid, v_admin, 'admin', 'active', now());
    INSERT INTO public.community_members (community_id, user_id, role, status, joined_at)
    VALUES (v_cid, v_events, 'events', 'active', now());

    -- ============ CASE 1: is_community_owner is Owner-only =================
    IF NOT public.is_community_owner(v_cid, v_owner) THEN
      RAISE EXCEPTION 'self-test C1: owner not recognized as owner';
    END IF;
    IF public.is_community_owner(v_cid, v_admin) THEN
      RAISE EXCEPTION 'self-test C1: admin wrongly recognized as owner';
    END IF;

    -- ============ CASE 2: can_manage_community_events is Events+, not =====
    -- ============ Member care/Finance ========================================
    IF NOT public.can_manage_community_events(v_cid, v_events) THEN
      RAISE EXCEPTION 'self-test C2: events tier cannot manage events';
    END IF;
    IF NOT public.can_manage_community_events(v_cid, v_admin) THEN
      RAISE EXCEPTION 'self-test C2: admin cannot manage events';
    END IF;
    IF public.can_manage_community_members(v_cid, v_events) THEN
      RAISE EXCEPTION 'self-test C2 FAIL: events tier wrongly granted member-management';
    END IF;

    -- ============ CASE 3: set_community_member_role, owner-only, leader ===
    -- ============ rejected, self-role-change rejected ======================
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    v_raised := false;
    BEGIN
      PERFORM public.set_community_member_role(v_cid, v_events, 'member_care');
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C3 FAIL: a non-owner (admin) retiered a co-creator';
    END IF;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    v_raised := false;
    BEGIN
      PERFORM public.set_community_member_role(v_cid, v_admin, 'leader');
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C3 FAIL: set_community_member_role granted ownership transfer';
    END IF;

    v_raised := false;
    BEGIN
      PERFORM public.set_community_member_role(v_cid, v_owner, 'admin');
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C3 FAIL: owner was able to retier themself';
    END IF;

    PERFORM public.set_community_member_role(v_cid, v_events, 'member_care');
    IF NOT EXISTS (
      SELECT 1 FROM public.community_members
      WHERE community_id = v_cid AND user_id = v_events AND role = 'member_care'
    ) THEN
      RAISE EXCEPTION 'self-test C3 FAIL: the owner''s legitimate retier did not apply';
    END IF;
    -- restore for the later cases
    PERFORM public.set_community_member_role(v_cid, v_events, 'events');

    -- ============ CASE 4: the role-change trigger blocks a raw non-owner ===
    -- ============ UPDATE even though community_members_update's RLS ========
    -- ============ admits a Member-care caller for a STATUS change ==========
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    INSERT INTO public.community_members (community_id, user_id, role, status, joined_at)
    VALUES (v_cid, v_outsider, 'member_care', 'active', now());

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
    SET LOCAL role = authenticated;
    v_raised := false;
    BEGIN
      UPDATE public.community_members SET role = 'admin'
      WHERE community_id = v_cid AND user_id = v_events;
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    RESET role;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C4 FAIL: a member_care caller changed a role via raw UPDATE';
    END IF;

    -- ============ CASE 5: leave_community narrowed to leader-only ==========
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    PERFORM public.leave_community(v_cid);  -- must NOT raise
    IF EXISTS (
      SELECT 1 FROM public.community_members
      WHERE community_id = v_cid AND user_id = v_admin AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'self-test C5 FAIL: admin could not leave';
    END IF;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    v_raised := false;
    BEGIN
      PERFORM public.leave_community(v_cid);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C5 FAIL: the owner (last leader) was allowed to leave';
    END IF;

    -- ============ CASE 6: community_members_select widened for Member ======
    -- ============ care (sees a pending row), still refused to an events- ===
    -- ============ tier co-creator ===========================================
    INSERT INTO public.community_members (community_id, user_id, role, status)
    VALUES (v_cid, v_outsider, 'member', 'pending')
    ON CONFLICT (community_id, user_id) DO UPDATE SET role = 'member', status = 'pending';
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    UPDATE public.community_members SET role = 'member_care' WHERE community_id = v_cid AND user_id = v_events;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_events, 'role', 'authenticated')::text, true);
    SET LOCAL role = authenticated;
    IF NOT EXISTS (
      SELECT 1 FROM public.community_members WHERE community_id = v_cid AND user_id = v_outsider AND status = 'pending'
    ) THEN
      RESET role;
      RAISE EXCEPTION 'self-test C6 FAIL: member_care cannot see a pending member';
    END IF;
    RESET role;

    -- ============ CASE 7: the owner cannot raw-UPDATE anyone to 'leader' ====
    -- ============ (the vulnerability this file's trigger fix closes) =======
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    SET LOCAL role = authenticated;
    v_raised := false;
    BEGIN
      UPDATE public.community_members SET role = 'leader'
      WHERE community_id = v_cid AND user_id = v_events;
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    RESET role;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C7 FAIL: owner raw-UPDATE minted a second leader row';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.community_members
      WHERE community_id = v_cid AND user_id = v_events AND role = 'leader'
    ) THEN
      RAISE EXCEPTION 'self-test C7 FAIL: a second active leader row exists';
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'community role tiers self-test passed (7 cases)';
END $$;

COMMIT;
