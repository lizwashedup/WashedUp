-- REVIEW ONLY. Forward migration. Do not apply without explicit approval.
--
-- O-03 (Creator Space Complete Inventory): "Follower communication and
-- settings -- event announcements to followers; native quick update, web
-- schedule/history. Behavior: preview audience/channel, send, schedule,
-- opt-out state. Followers can unfollow; they never become members or gain
-- a room." Confirmed this session (fork "confirm-producer-messaging-gap")
-- as a genuine, total gap on both platforms: no send path existed anywhere.
--
-- Polymorphic target (community OR standalone organizer), same shape as
-- proposal 68's organizer_follows, because the doc's own follow model
-- already treats both audiences identically -- a community can have
-- followers who never joined as members, and a standalone organizer's
-- followers ARE its only audience. Community leaders keep community_broadcasts
-- for messaging MEMBERS; this table is followers only, a different, smaller
-- audience. This is a deliberate small widening beyond O-03's literal
-- "Organization inventory" placement -- flagged, not silent -- because the
-- underlying data model and "opt-out = unfollow" behavior are identical for
-- both, and building it organizer-only would have thrown away half the
-- schema for no real savings.
--
-- No email/SMS: this project has no configured provider (a separate,
-- undecided, real-cost call). Delivery is in-app only, read via a query
-- against this table -- same "insert a row, RLS decides who reads it"
-- pattern as community_broadcasts/sendCommunityMessage, not a new mechanism.
--
-- Scheduling without cron: visible_at defaults to now() (native's "quick
-- update" = always now()). Web can set a future visible_at to schedule --
-- the SELECT policy hides it from followers until that time passes, no
-- pg_cron or worker needed. The sender's own history view always sees their
-- own rows regardless of visible_at, so a scheduled-not-yet-sent item still
-- shows up there.
--
-- Opt-out: the doc's own words are "Followers can unfollow" -- there is no
-- separate granular preference. Unfollowing (proposal 68's
-- organizer_follows delete policy, already live in that migration) IS the
-- opt-out; a deleted follow row simply drops out of the audience the next
-- send computes against. No new column needed for this.

begin;

-- ---------------------------------------------------------------------------
-- 1. the table
-- ---------------------------------------------------------------------------
create table public.follower_broadcasts (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  community_id uuid references public.communities(id) on delete cascade,
  organizer_user_id uuid references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) > 0 and char_length(body) <= 2000),
  visible_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint follower_broadcasts_exactly_one_target check (
    (community_id is not null and organizer_user_id is null)
    or (community_id is null and organizer_user_id is not null)
  )
);

create index follower_broadcasts_community_idx
  on public.follower_broadcasts (community_id, visible_at desc) where community_id is not null;
create index follower_broadcasts_organizer_idx
  on public.follower_broadcasts (organizer_user_id, visible_at desc) where organizer_user_id is not null;
create index follower_broadcasts_sender_history_idx
  on public.follower_broadcasts (sender_user_id, created_at desc);

comment on table public.follower_broadcasts is
  'O-03: an announcement to a community''s or standalone organizer''s FOLLOWERS (proposal 68 organizer_follows), never its members. In-app only, no email/SMS. visible_at in the future = scheduled (web only); native never sets it.';

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
alter table public.follower_broadcasts enable row level security;

-- read: the sender always sees their own full history (including
-- not-yet-visible scheduled rows); a follower only sees rows whose
-- visible_at has passed; admins see everything.
create policy follower_broadcasts_select on public.follower_broadcasts
  for select using (
    sender_user_id = (select auth.uid())
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
    or (
      visible_at <= now()
      and (
        (organizer_user_id is not null and exists (
          select 1 from public.organizer_follows f
          where f.follower_user_id = (select auth.uid())
            and f.organizer_user_id = follower_broadcasts.organizer_user_id
        ))
        or (community_id is not null and exists (
          select 1 from public.organizer_follows f
          where f.follower_user_id = (select auth.uid())
            and f.community_id = follower_broadcasts.community_id
        ))
      )
    )
  );

-- write: you can only ever send as yourself, either as the standalone
-- organizer being followed, or as a real leader of the target community.
create policy follower_broadcasts_insert on public.follower_broadcasts
  for insert to authenticated
  with check (
    sender_user_id = (select auth.uid())
    and (
      (organizer_user_id = (select auth.uid()) and community_id is null)
      or (community_id is not null and is_community_leader(community_id, (select auth.uid())))
    )
  );

revoke insert, update, delete on public.follower_broadcasts from anon;
grant select, insert on public.follower_broadcasts to authenticated;

-- ---------------------------------------------------------------------------
-- 3. in-transaction self-test (never strip on apply)
-- ---------------------------------------------------------------------------
do $$
declare
  v_organizer uuid;
  v_follower uuid;
  v_stranger uuid;
  v_leader uuid;
  v_cid uuid;
  v_count integer;
  v_raised boolean;
  v_row_id uuid;
  v_inserted_organizer_profile boolean := false;
begin
  select id into v_organizer from auth.users u
  where not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_follower from auth.users u
  where u.id <> v_organizer
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_stranger from auth.users u
  where u.id not in (v_organizer, v_follower)
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  if v_organizer is null or v_follower is null or v_stranger is null then
    raise exception 'SELF-TEST FAIL: needs three existing non-admin users';
  end if;
  v_leader := v_organizer;

  -- organizer_follows.organizer_user_id FK's to organizer_profiles, so a
  -- plain auth.users row (what v_organizer is) is not itself a valid follow
  -- target -- give it a temp profile row here, same self-contained-fixture
  -- approach this test already uses for the community path below, rather
  -- than assuming production happens to have an organizer on hand.
  insert into public.organizer_profiles (user_id, display_name)
  values (v_organizer, 'selftest-o03-organizer')
  on conflict (user_id) do nothing
  returning true into v_inserted_organizer_profile;
  v_inserted_organizer_profile := coalesce(v_inserted_organizer_profile, false);

  -- table + RLS + policies
  select count(*) into v_count from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'follower_broadcasts' and c.relrowsecurity;
  if v_count <> 1 then
    raise exception 'SELF-TEST FAIL: follower_broadcasts missing or RLS off';
  end if;
  select count(*) into v_count from pg_policies
  where schemaname = 'public' and tablename = 'follower_broadcasts';
  if v_count <> 2 then
    raise exception 'SELF-TEST FAIL: expected 2 policies on follower_broadcasts, found %', v_count;
  end if;

  -- exactly-one-target check constraint
  v_raised := false;
  begin
    insert into public.follower_broadcasts (sender_user_id, community_id, organizer_user_id, body)
    values (v_organizer, '00000000-0000-0000-0000-000000000000', v_organizer, 'x');
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a broadcast with both targets set was accepted';
  end if;

  -- empty body rejected
  v_raised := false;
  begin
    insert into public.follower_broadcasts (sender_user_id, organizer_user_id, body)
    values (v_organizer, v_organizer, '   ');
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a whitespace-only body was accepted';
  end if;

  -- a stranger cannot send as the organizer
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    insert into public.follower_broadcasts (sender_user_id, organizer_user_id, body)
    values (v_stranger, v_organizer, 'not yours to send');
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a non-organizer could send as another organizer';
  end if;

  -- the real organizer sends fine, lands immediately visible (visible_at default now())
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_organizer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.follower_broadcasts (sender_user_id, organizer_user_id, body)
  values (v_organizer, v_organizer, 'first update')
  returning id into v_row_id;
  reset role;

  -- a stranger (not following) cannot see it
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.follower_broadcasts where id = v_row_id;
  reset role;
  if v_count <> 0 then
    raise exception 'SELF-TEST FAIL: a non-follower could read a broadcast';
  end if;

  -- record a real follow, now the follower CAN see it
  insert into public.organizer_follows (follower_user_id, organizer_user_id) values (v_follower, v_organizer);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_follower, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.follower_broadcasts where id = v_row_id;
  reset role;
  if v_count <> 1 then
    raise exception 'SELF-TEST FAIL: a real follower could not read the organizer''s broadcast';
  end if;

  -- a scheduled (future visible_at) row is invisible to the follower...
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_organizer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.follower_broadcasts (sender_user_id, organizer_user_id, body, visible_at)
  values (v_organizer, v_organizer, 'scheduled', now() + interval '1 day')
  returning id into v_row_id;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_follower, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.follower_broadcasts where id = v_row_id;
  reset role;
  if v_count <> 0 then
    raise exception 'SELF-TEST FAIL: a not-yet-visible scheduled broadcast was readable by a follower';
  end if;

  -- ...but the SENDER still sees it in their own history
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_organizer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.follower_broadcasts where id = v_row_id;
  reset role;
  if v_count <> 1 then
    raise exception 'SELF-TEST FAIL: the sender could not see their own scheduled broadcast in history';
  end if;

  -- community path: a real leader can send to the community's followers,
  -- a plain member cannot
  insert into public.communities (handle, name, created_by, status)
  values ('selftest-o03-tmp', 'o03 selftest', v_leader, 'active')
  returning id into v_cid;
  insert into public.community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_leader, 'leader', 'active', now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    insert into public.follower_broadcasts (sender_user_id, community_id, body)
    values (v_stranger, v_cid, 'not a leader');
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a non-leader could send a community follower broadcast';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.follower_broadcasts (sender_user_id, community_id, body)
  values (v_leader, v_cid, 'community update');
  reset role;

  -- cleanup
  delete from public.follower_broadcasts where organizer_user_id = v_organizer or community_id = v_cid;
  delete from public.organizer_follows where follower_user_id = v_follower and organizer_user_id = v_organizer;
  delete from public.community_members where community_id = v_cid;
  delete from public.communities where id = v_cid;
  -- only remove the organizer_profiles row if THIS test created it -- never
  -- touch a real pre-existing organizer's profile
  if v_inserted_organizer_profile then
    delete from public.organizer_profiles where user_id = v_organizer;
  end if;

  raise notice 'O-03 (follower_broadcasts) self-test passed';
end;
$$;

commit;
