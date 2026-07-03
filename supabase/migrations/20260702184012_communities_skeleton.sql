-- ============================================================================
-- phase 1 skeleton: communities, members, blocks, operator grants,
-- explore_events ownership, community chat plumbing.
--
-- PROPOSAL FOR REVIEW, 2026-07-01. NOT applied anywhere.
-- On go-ahead this becomes a migration in washedup-main/supabase/migrations/
-- (YYYYMMDDHHMMSS_communities_skeleton.sql) on branch feature/communities,
-- then is applied to prod via MCP. Additive only: no existing table, column,
-- enum, or policy is touched.
--
-- Design sources: 10-claude-code-kickoff-prompt.md phase 1, 06-data-model.md,
-- 08-creator-mode-proposal.md, 09-community-space-and-chat.md.
-- House rules honored: RLS on every new table from this migration,
-- (select auth.uid()) initplan-wrapped policies, one permissive policy per
-- command per table, admin override matches the existing
-- is_admin()/has_role() pattern, reuses update_updated_at_column(),
-- in-transaction self-test at the bottom (never strip it on apply).
--
-- Deliberate calls, flagged for review:
--   * community_member_status includes 'left' (beyond the kickoff list):
--     members can leave at any time (doc 03 section 5), and leaving is not
--     being removed. Leaving goes through the leave_community() RPC.
--   * No 'attribution' column on explore_events: attribution is derived.
--     community_id set = community event; host_user_id set, community_id
--     null = standalone creator event; both null = admin-curated (all 7
--     existing rows stay untouched nulls).
--   * Topic creation is leaders-only in RLS for now (open question: member
--     topics). Loosening later is a policy swap, no schema change.
--   * Broadcast reply tables exist from day one (open question is only
--     whether the UI ships them); building the table now avoids a phase 3
--     migration either way.
--   * No explore_event_rsvps yet (just-join is phase 5, additive later).
--   * No payments anything, per the phase rules.
--
-- 2026-07-02: Cowork review fixes applied.
--   1. Probe-leak guard inside the three helper fns: they only answer about
--      yourself unless you are an admin (or service_role). Anyone else asking
--      about an arbitrary uuid gets false. Policies always pass auth.uid(),
--      so nothing else changes.
--   2. community_members identity is immutable: a trigger blocks UPDATEs to
--      community_id and user_id, so a leader cannot fabricate a membership
--      for someone who never joined.
--   3. Last-leader guard in leave_community(): the only remaining leader or
--      co_leader cannot leave a non-archived community.
--   All three are covered by new self-test assertions at the bottom.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. enums
-- ---------------------------------------------------------------------------

create type public.community_status as enum ('draft', 'active', 'archived');
-- draft: leader is setting the page up, not public yet. active: live and
-- world-visible. archived: wound down, hidden, data kept.

create type public.community_member_role as enum ('leader', 'co_leader', 'member');
create type public.community_member_status as enum ('pending', 'active', 'left', 'removed', 'banned');

create type public.operator_track as enum ('event_host', 'community_leader');
create type public.operator_grant_status as enum
  ('applied', 'in_review', 'needs_more_info', 'approved', 'declined', 'revoked');

create type public.community_block_type as enum
  ('cover', 'header', 'about', 'events_auto', 'members_auto', 'gallery', 'links', 'pinned');

-- ---------------------------------------------------------------------------
-- 2. operator_grants (replaces client-side role checks for creator features)
-- ---------------------------------------------------------------------------

create table public.operator_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track public.operator_track not null,
  status public.operator_grant_status not null default 'applied',
  application jsonb not null default '{}'::jsonb,   -- the form answers, incl business affiliation disclosure
  terms_accepted_at timestamptz,                    -- creator T&Cs checkbox (copy TBD by Liz)
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,                                -- admin-only notes, mirrors event_submissions.admin_notes
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, track)                           -- one row per user per track; reapplying updates it
);

create trigger update_operator_grants_updated_at
  before update on public.operator_grants
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 3. communities
-- ---------------------------------------------------------------------------

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique
    check (handle ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),  -- washedup.app/c/handle
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 2000),
  accent_color text check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),  -- opt-in branding, null = house default
  status public.community_status not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,  -- nullable so admin_cascade_delete_user keeps working; leadership lives in community_members
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger update_communities_updated_at
  before update on public.communities
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 4. community_members
-- ---------------------------------------------------------------------------

create table public.community_members (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.community_member_role not null default 'member',
  status public.community_member_status not null default 'pending',
  join_answers jsonb,                               -- answers to leader-set join questions, null if none
  joined_at timestamptz,                            -- set when status first flips to active
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, user_id)
);

create index community_members_user_active_idx
  on public.community_members (user_id) where status = 'active';
create index community_members_community_status_idx
  on public.community_members (community_id, status);

create trigger update_community_members_updated_at
  before update on public.community_members
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 5. community_blocks (one tree, three projections: app home, /c/handle, lock view)
-- ---------------------------------------------------------------------------

create table public.community_blocks (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  block_type public.community_block_type not null,
  position integer not null default 0,
  visible boolean not null default true,            -- the eye toggle
  content jsonb not null default '{}'::jsonb,       -- per-type payload; empty for events_auto / members_auto
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index community_blocks_community_position_idx
  on public.community_blocks (community_id, position);

create trigger update_community_blocks_updated_at
  before update on public.community_blocks
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 6. ownership on explore_events (additive, null for all existing rows)
-- ---------------------------------------------------------------------------

alter table public.explore_events
  add column host_user_id uuid references auth.users(id) on delete set null,
  add column community_id uuid references public.communities(id) on delete set null;

create index explore_events_community_idx
  on public.explore_events (community_id) where community_id is not null;
create index explore_events_host_idx
  on public.explore_events (host_user_id) where host_user_id is not null;

-- ---------------------------------------------------------------------------
-- 7. community chat: NEW plumbing beside plan chat and circle chat.
--    No expiry anywhere in these tables; permanence is by construction.
-- ---------------------------------------------------------------------------

-- broadcasts: leader-only posts, pinned at the top of the community card
create table public.community_broadcasts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,  -- the leader who posted; the post is the community's voice, survives account deletion
  body text not null check (char_length(body) between 1 and 4000),
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

create index community_broadcasts_community_idx
  on public.community_broadcasts (community_id, created_at desc);

create table public.community_broadcast_reactions (
  broadcast_id uuid not null references public.community_broadcasts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (broadcast_id, user_id, emoji)
);

-- reply threads hanging off each broadcast (Telegram linked-discussion pattern)
create table public.community_broadcast_replies (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.community_broadcasts(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index community_broadcast_replies_broadcast_idx
  on public.community_broadcast_replies (broadcast_id, created_at);

-- topics: opt-in member threads (WhatsApp subgroups). Joining = subscribing
-- to notifications; any active member can read.
create table public.community_topics (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid references auth.users(id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index community_topics_community_idx
  on public.community_topics (community_id) where not archived;

create table public.community_topic_members (
  topic_id uuid not null references public.community_topics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  notifications_on boolean not null default true,   -- topics push ON once joined, per the doc 09 defaults table
  joined_at timestamptz not null default now(),
  primary key (topic_id, user_id)
);

create table public.community_topic_messages (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.community_topics(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index community_topic_messages_topic_idx
  on public.community_topic_messages (topic_id, created_at desc);

-- membership-scoped read markers (mirrors the chat_reads last-read pattern)
create table public.community_broadcast_reads (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create table public.community_topic_reads (
  topic_id uuid not null references public.community_topics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (topic_id, user_id)
);

-- realtime for the chat surfaces (same mechanism plan chat uses on messages)
alter publication supabase_realtime add table
  public.community_broadcasts,
  public.community_broadcast_replies,
  public.community_topic_messages;

-- ---------------------------------------------------------------------------
-- 8. helper functions (security definer so RLS policies never self-recurse)
-- ---------------------------------------------------------------------------

-- All three helpers carry a probe-leak guard: they only answer about the
-- caller themself, unless the caller is an admin or service_role. A client
-- probing an arbitrary (community, user) pair gets false, never the truth
-- about someone else. RLS policies always pass (select auth.uid()), so they
-- are unaffected.

create or replace function public.has_operator_grant(p_user_id uuid, p_track public.operator_track)
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
    select 1 from operator_grants
    where user_id = p_user_id and track = p_track and status = 'approved'
  );
$$;

create or replace function public.is_community_member(p_community_id uuid, p_user_id uuid)
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
    where community_id = p_community_id and user_id = p_user_id and status = 'active'
  );
$$;

create or replace function public.is_community_leader(p_community_id uuid, p_user_id uuid)
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
      and status = 'active' and role in ('leader', 'co_leader')
  );
$$;

-- membership identity is immutable: leaders manage role and status, never
-- WHO the row belongs to or WHERE it belongs
create or replace function public.community_members_identity_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.community_id <> old.community_id or new.user_id <> old.user_id or new.id <> old.id then
    raise exception 'community membership identity cannot be changed';
  end if;
  return new;
end;
$$;

create trigger community_members_identity_guard
  before update on public.community_members
  for each row execute function public.community_members_identity_immutable();

-- atomic community creation: the community row, the leader membership, and
-- the default block tree land together or not at all. Server-side grant
-- check, never client-side.
create or replace function public.create_community(
  p_handle text,
  p_name text,
  p_description text default null
)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_operator_grant(v_uid, 'community_leader') then
    raise exception 'Community Leader grant required';
  end if;

  insert into communities (handle, name, description, created_by)
  values (p_handle, p_name, p_description, v_uid)
  returning id into v_id;

  insert into community_members (community_id, user_id, role, status, joined_at)
  values (v_id, v_uid, 'leader', 'active', now());

  insert into community_blocks (community_id, block_type, position) values
    (v_id, 'cover', 0),
    (v_id, 'header', 1),
    (v_id, 'about', 2),
    (v_id, 'events_auto', 3),
    (v_id, 'members_auto', 4);

  return v_id;
end;
$$;

-- leaving is an RPC, not a raw UPDATE, so a member can only ever set
-- themselves to left (and drops any leadership role on the way out).
-- Last-leader guard: the only remaining leader or co_leader cannot leave a
-- non-archived community; appoint a co-leader or archive it first.
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

  if v_role in ('leader', 'co_leader')
     and exists (select 1 from communities c
                 where c.id = p_community_id and c.status <> 'archived')
     and not exists (select 1 from community_members cm
                     where cm.community_id = p_community_id
                       and cm.user_id <> v_uid
                       and cm.status = 'active'
                       and cm.role in ('leader', 'co_leader')) then
    raise exception 'You are the last leader of this community. Appoint a co-leader or archive it first.';
  end if;

  update community_members
  set status = 'left', role = 'member'
  where community_id = p_community_id
    and user_id = v_uid
    and status = 'active';
end;
$$;

revoke all on function public.has_operator_grant(uuid, public.operator_track) from public;
revoke all on function public.is_community_member(uuid, uuid) from public;
revoke all on function public.is_community_leader(uuid, uuid) from public;
revoke all on function public.create_community(text, text, text) from public;
revoke all on function public.leave_community(uuid) from public;
grant execute on function public.has_operator_grant(uuid, public.operator_track) to authenticated, anon;
grant execute on function public.is_community_member(uuid, uuid) to authenticated, anon;
grant execute on function public.is_community_leader(uuid, uuid) to authenticated, anon;
grant execute on function public.create_community(text, text, text) to authenticated;
grant execute on function public.leave_community(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. RLS: enabled on every new table, one permissive policy per command.
--    Admin override matches the existing explore_events pattern.
-- ---------------------------------------------------------------------------

alter table public.operator_grants enable row level security;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_blocks enable row level security;
alter table public.community_broadcasts enable row level security;
alter table public.community_broadcast_reactions enable row level security;
alter table public.community_broadcast_replies enable row level security;
alter table public.community_topics enable row level security;
alter table public.community_topic_members enable row level security;
alter table public.community_topic_messages enable row level security;
alter table public.community_broadcast_reads enable row level security;
alter table public.community_topic_reads enable row level security;

-- operator_grants: apply for yourself, see your own; admins review.
-- Users cannot UPDATE at all (no self-approval path); reapplying after a
-- decline is an admin flow or a phase 2 RPC.
create policy operator_grants_select on public.operator_grants
  for select using (
    user_id = (select auth.uid())
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy operator_grants_insert on public.operator_grants
  for insert with check (
    user_id = (select auth.uid())
    and status = 'applied'
    and reviewed_by is null and reviewed_at is null and review_notes is null
  );
create policy operator_grants_update on public.operator_grants
  for update using (is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role))
  with check (is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role));
create policy operator_grants_delete on public.operator_grants
  for delete using (is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role));

-- communities: active ones are world-readable (directory, lock view, /c/handle
-- needs anon read); members and leaders see their own drafts/archives.
-- Creation goes through create_community(), so no INSERT policy for users.
create policy communities_select on public.communities
  for select using (
    status = 'active'
    or is_community_member(id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy communities_update on public.communities
  for update using (
    is_community_leader(id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  )
  with check (
    is_community_leader(id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy communities_delete on public.communities
  for delete using (is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role));

-- community_members: you always see your own row; active members see the
-- member wall; leaders see everything including pending. Join = INSERT your
-- own pending member row. Approvals, removals, bans, co-leader promotion are
-- leader/admin UPDATEs. Leaving is the leave_community() RPC.
create policy community_members_select on public.community_members
  for select using (
    user_id = (select auth.uid())
    or (status = 'active' and is_community_member(community_id, (select auth.uid())))
    or is_community_leader(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy community_members_insert on public.community_members
  for insert with check (
    user_id = (select auth.uid())
    and role = 'member'
    and status = 'pending'
    and exists (select 1 from communities c where c.id = community_id and c.status = 'active')
  );
create policy community_members_update on public.community_members
  for update using (
    is_community_leader(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  )
  with check (
    is_community_leader(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy community_members_delete on public.community_members
  for delete using (is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role));

-- community_blocks: visible blocks of active communities are world-readable
-- (the /c/handle page and the lock view are anon surfaces; which blocks each
-- projection renders is app logic). Leaders see and edit everything.
create policy community_blocks_select on public.community_blocks
  for select using (
    (visible and exists (select 1 from communities c where c.id = community_id and c.status = 'active'))
    or is_community_leader(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy community_blocks_insert on public.community_blocks
  for insert with check (
    is_community_leader(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy community_blocks_update on public.community_blocks
  for update using (
    is_community_leader(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  )
  with check (
    is_community_leader(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy community_blocks_delete on public.community_blocks
  for delete using (
    is_community_leader(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

-- community_broadcasts: members read, leaders write. Never world-readable
-- (unlike the global broadcasts table).
create policy community_broadcasts_select on public.community_broadcasts
  for select using (
    is_community_member(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy community_broadcasts_insert on public.community_broadcasts
  for insert with check (
    sender_id = (select auth.uid())
    and is_community_leader(community_id, (select auth.uid()))
  );
create policy community_broadcasts_update on public.community_broadcasts
  for update using (
    is_community_leader(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  )
  with check (
    is_community_leader(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy community_broadcasts_delete on public.community_broadcasts
  for delete using (
    is_community_leader(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

-- reactions: members react as themselves, remove their own.
create policy community_broadcast_reactions_select on public.community_broadcast_reactions
  for select using (
    exists (
      select 1 from community_broadcasts b
      where b.id = broadcast_id and is_community_member(b.community_id, (select auth.uid()))
    )
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy community_broadcast_reactions_insert on public.community_broadcast_reactions
  for insert with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from community_broadcasts b
      where b.id = broadcast_id and is_community_member(b.community_id, (select auth.uid()))
    )
  );
create policy community_broadcast_reactions_delete on public.community_broadcast_reactions
  for delete using (user_id = (select auth.uid()));

-- replies: members write as themselves; delete own, leaders moderate.
create policy community_broadcast_replies_select on public.community_broadcast_replies
  for select using (
    exists (
      select 1 from community_broadcasts b
      where b.id = broadcast_id and is_community_member(b.community_id, (select auth.uid()))
    )
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy community_broadcast_replies_insert on public.community_broadcast_replies
  for insert with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from community_broadcasts b
      where b.id = broadcast_id and is_community_member(b.community_id, (select auth.uid()))
    )
  );
create policy community_broadcast_replies_delete on public.community_broadcast_replies
  for delete using (
    sender_id = (select auth.uid())
    or exists (
      select 1 from community_broadcasts b
      where b.id = broadcast_id and is_community_leader(b.community_id, (select auth.uid()))
    )
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

-- topics: members browse (that is the joinable-topics list), leaders create
-- and archive. Member-created topics = open question; if Liz says yes, this
-- INSERT policy loosens, no schema change.
create policy community_topics_select on public.community_topics
  for select using (
    is_community_member(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy community_topics_insert on public.community_topics
  for insert with check (
    created_by = (select auth.uid())
    and is_community_leader(community_id, (select auth.uid()))
  );
create policy community_topics_update on public.community_topics
  for update using (
    is_community_leader(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  )
  with check (
    is_community_leader(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy community_topics_delete on public.community_topics
  for delete using (
    is_community_leader(community_id, (select auth.uid()))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

-- topic membership: join and leave yourself (community members only);
-- membership visible inside the community; leaders can remove.
create policy community_topic_members_select on public.community_topic_members
  for select using (
    user_id = (select auth.uid())
    or exists (
      select 1 from community_topics t
      where t.id = topic_id and is_community_member(t.community_id, (select auth.uid()))
    )
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy community_topic_members_insert on public.community_topic_members
  for insert with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from community_topics t
      where t.id = topic_id and not t.archived
        and is_community_member(t.community_id, (select auth.uid()))
    )
  );
create policy community_topic_members_update on public.community_topic_members
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));   -- notifications_on toggle
create policy community_topic_members_delete on public.community_topic_members
  for delete using (
    user_id = (select auth.uid())
    or exists (
      select 1 from community_topics t
      where t.id = topic_id and is_community_leader(t.community_id, (select auth.uid()))
    )
  );

-- topic messages: any active community member reads (joining a topic is a
-- notification subscription, doc 09); you must have joined the topic to
-- post; delete own, leaders moderate.
create policy community_topic_messages_select on public.community_topic_messages
  for select using (
    exists (
      select 1 from community_topics t
      where t.id = topic_id and is_community_member(t.community_id, (select auth.uid()))
    )
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy community_topic_messages_insert on public.community_topic_messages
  for insert with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from community_topic_members tm
      where tm.topic_id = community_topic_messages.topic_id
        and tm.user_id = (select auth.uid())
    )
    and exists (
      select 1 from community_topics t
      where t.id = topic_id and not t.archived
        and is_community_member(t.community_id, (select auth.uid()))
    )
  );
create policy community_topic_messages_delete on public.community_topic_messages
  for delete using (
    sender_id = (select auth.uid())
    or exists (
      select 1 from community_topics t
      where t.id = topic_id and is_community_leader(t.community_id, (select auth.uid()))
    )
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

-- read markers: yours and only yours.
create policy community_broadcast_reads_all on public.community_broadcast_reads
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy community_topic_reads_all on public.community_topic_reads
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 10. in-transaction self-test (the atomic rollback net, never strip on apply)
-- ---------------------------------------------------------------------------

do $$
declare
  v_tbl text;
  v_rls boolean;
  v_policies int;
begin
  -- every new table must have RLS enabled and at least one policy
  for v_tbl in select unnest(array[
    'operator_grants','communities','community_members','community_blocks',
    'community_broadcasts','community_broadcast_reactions','community_broadcast_replies',
    'community_topics','community_topic_members','community_topic_messages',
    'community_broadcast_reads','community_topic_reads'])
  loop
    select relrowsecurity into v_rls from pg_class
    where oid = ('public.' || v_tbl)::regclass;
    if not v_rls then
      raise exception 'SELF-TEST FAIL: RLS not enabled on %', v_tbl;
    end if;
    select count(*) into v_policies from pg_policies
    where schemaname = 'public' and tablename = v_tbl;
    if v_policies = 0 then
      raise exception 'SELF-TEST FAIL: no policies on %', v_tbl;
    end if;
  end loop;

  -- explore_events gained exactly the two nullable ownership columns
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'explore_events'
        and column_name in ('host_user_id','community_id')
        and is_nullable = 'YES') <> 2 then
    raise exception 'SELF-TEST FAIL: explore_events ownership columns missing or not nullable';
  end if;

  -- all existing explore_events rows untouched (still unowned)
  if exists (select 1 from public.explore_events
             where host_user_id is not null or community_id is not null) then
    raise exception 'SELF-TEST FAIL: existing explore_events rows gained ownership';
  end if;

  -- helper functions exist and answer false for a nobody
  if public.has_operator_grant('00000000-0000-0000-0000-000000000000'::uuid, 'community_leader') then
    raise exception 'SELF-TEST FAIL: has_operator_grant false positive';
  end if;
  if public.is_community_member('00000000-0000-0000-0000-000000000000'::uuid,
                                '00000000-0000-0000-0000-000000000000'::uuid) then
    raise exception 'SELF-TEST FAIL: is_community_member false positive';
  end if;

  raise notice 'communities skeleton self-test passed';
end;
$$;

-- live-row self-test for the three review fixes (probe guard, identity
-- immutability, last-leader guard). Uses two real user ids, cleans up after
-- itself, and simulates auth via transaction-local jwt claims.
do $$
declare
  v_user uuid;
  v_user2 uuid;
  v_cid uuid;
  v_raised boolean;
begin
  -- two non-admin users, so the probe assertions cannot be short-circuited
  -- by the admin override in the guard
  select id into v_user from auth.users u
  where not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_user2 from auth.users u
  where u.id <> v_user
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  if v_user is null or v_user2 is null then
    raise exception 'SELF-TEST FAIL: needs two existing non-admin users to run';
  end if;

  insert into public.communities (handle, name, created_by, status)
  values ('selftest-skeleton-tmp', 'self test', v_user, 'draft')
  returning id into v_cid;
  insert into public.community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_user, 'leader', 'active', now());

  -- fix 1a: an unauthenticated caller cannot see a real membership
  if public.is_community_member(v_cid, v_user) then
    raise exception 'SELF-TEST FAIL: membership probe not blocked without auth';
  end if;

  -- fix 1b: the member themself still gets a true answer
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  if not public.is_community_member(v_cid, v_user) then
    raise exception 'SELF-TEST FAIL: self membership check broken by probe guard';
  end if;

  -- fix 1c: another authenticated user probing that membership gets false
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user2, 'role', 'authenticated')::text, true);
  if public.is_community_member(v_cid, v_user) then
    raise exception 'SELF-TEST FAIL: membership probe leak across users';
  end if;

  -- fix 3: the last leader cannot leave
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_raised := false;
  begin
    perform public.leave_community(v_cid);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: last leader was allowed to leave';
  end if;

  -- fix 2: membership identity is immutable
  v_raised := false;
  begin
    update public.community_members set user_id = v_user2 where community_id = v_cid;
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: membership identity was mutable';
  end if;

  -- cleanup (cascades to members and blocks) and drop the simulated auth
  delete from public.communities where id = v_cid;
  perform set_config('request.jwt.claims', null, true);

  raise notice 'review-fix self-test passed';
end;
$$;

commit;
