-- Album support for event-chat topics (CTO spec item 04: "follows familiar
-- Plans-chat behaviors such as albums, but is not a Plans entry").
--
-- Deliberately a NEW, parallel, minimal set of tables rather than extending
-- plan_albums: that table's event_id is a hard FK to events(id) (the Plans
-- table) and its RLS/RPCs are wired to event_members throughout. Community
-- event chats key off explore_events/community_topics instead, with no
-- event_members row at all. Reusing plan_albums would mean either a fake
-- events(id) row per topic or breaking its FK -- both worse than a small
-- parallel table.
--
-- Deliberately smaller than plan_albums' 5-table shape: no marketing-consent
-- / Instagram-TikTok-testimonial capture (that is Plans' post-event UGC
-- marketing pipeline, not asked for here) and no per-viewer visibility table
-- (event-chat has no equivalent of Plans' "only visible to people you chose"
-- -- every topic member sees every upload in that topic's album, matching
-- how topic messages already work). No heart reactions for the same reason:
-- not part of the stated spec, easy to add later as its own small migration
-- if wanted. Flag both simplifications back before assuming they're final.
--
-- Includes the full SC-08/SC-09/C-24 room-config gate (album on/off,
-- creator-controlled; archived hard-stop reusing the same flag chat already
-- enforces) added 2026-08-24 before this ever went live, so the feature
-- ships complete on first application rather than in two passes.

begin;

create table public.community_topic_albums (
  id         uuid primary key default gen_random_uuid(),
  topic_id   uuid not null unique references public.community_topics(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.community_topic_album_uploads (
  id                 uuid primary key default gen_random_uuid(),
  topic_album_id     uuid not null references public.community_topic_albums(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  media_url          text not null,
  thumbnail_url      text,
  display_url        text,
  content_type       text not null check (content_type in ('photo','video')),
  media_format       text not null,
  file_size_bytes    bigint not null check (file_size_bytes > 0),
  video_duration_sec integer check (video_duration_sec is null or video_duration_sec <= 60),
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index community_topic_album_uploads_album_idx
  on public.community_topic_album_uploads (topic_album_id) where deleted_at is null;
create index community_topic_album_uploads_user_idx
  on public.community_topic_album_uploads (user_id);

-- SC-09/C-24: "album on/off" is a room-level configuration item the event's
-- creator controls, same family as the room's other config (welcome copy,
-- expiry). Defaults OFF -- a conservative launch posture for a brand-new,
-- not-yet-Liz-reviewed capability being turned on across every event room;
-- flip the default later if that turns out to be the wrong call, this is a
-- technical choice, not a cited product decision.
alter table public.community_topics
  add column if not exists album_enabled boolean not null default false;

alter table public.community_topic_albums        enable row level security;
alter table public.community_topic_album_uploads  enable row level security;

create policy community_topic_albums_select on public.community_topic_albums
  for select using (
    exists (
      select 1 from community_topics t
      where t.id = community_topic_albums.topic_id
        and (
          is_community_member(t.community_id, (select auth.uid()))
          or (t.explore_event_id is not null and is_topic_member(t.id, (select auth.uid())))
        )
    )
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

create policy community_topic_album_uploads_select on public.community_topic_album_uploads
  for select using (
    deleted_at is null
    and exists (
      select 1 from community_topic_albums ta
      join community_topics t on t.id = ta.topic_id
      where ta.id = community_topic_album_uploads.topic_album_id
        and (
          is_community_member(t.community_id, (select auth.uid()))
          or (t.explore_event_id is not null and is_topic_member(t.id, (select auth.uid())))
        )
    )
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

create or replace function public.start_topic_album_upload_batch(
  p_topic_id uuid,
  p_uploads jsonb
)
returns uuid[]
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid := auth.uid();
  v_album_id uuid;
  v_upload jsonb;
  v_upload_id uuid;
  v_result uuid[] := array[]::uuid[];
  v_album_enabled boolean;
  v_archived boolean;
begin
  if v_user_id is null then
    raise exception 'Not signed in';
  end if;
  if p_uploads is null or jsonb_typeof(p_uploads) <> 'array' or jsonb_array_length(p_uploads) = 0 then
    raise exception 'p_uploads must be a non-empty JSON array';
  end if;
  if not is_topic_member(p_topic_id, v_user_id) then
    raise exception 'Not a member of this chat' using errcode = 'insufficient_privilege';
  end if;

  -- SC-09/C-24: album on/off (creator-controlled, see set_topic_album_enabled)
  -- and the room's existing archived hard-stop (event_end+48h, same flag
  -- community-topic chat already enforces) both gate new uploads server-side.
  -- Viewing/reading is untouched by either flag -- same parity as chat
  -- history staying readable in a closed room.
  select album_enabled, archived into v_album_enabled, v_archived
  from community_topics where id = p_topic_id;
  if v_album_enabled is null then
    raise exception 'topic not found';
  end if;
  if not v_album_enabled then
    raise exception 'Photos are not turned on for this event' using errcode = 'insufficient_privilege';
  end if;
  if v_archived then
    raise exception 'This room is closed' using errcode = 'insufficient_privilege';
  end if;

  insert into community_topic_albums (topic_id)
  values (p_topic_id)
  on conflict (topic_id) do update set topic_id = excluded.topic_id
  returning id into v_album_id;

  for v_upload in select * from jsonb_array_elements(p_uploads) loop
    if (v_upload->>'id') is null then
      raise exception 'each upload must include an id (uuid)';
    end if;
    if (string_to_array(v_upload->>'media_url', '/'))[3] <> (v_upload->>'id') then
      raise exception 'media_url path[3] must equal the upload id';
    end if;
    if (string_to_array(v_upload->>'media_url', '/'))[1] <> p_topic_id::text then
      raise exception 'media_url path[1] must equal the topic id';
    end if;
    if (string_to_array(v_upload->>'media_url', '/'))[2] <> v_user_id::text then
      raise exception 'media_url path[2] must equal the caller user id';
    end if;

    insert into community_topic_album_uploads (
      id, topic_album_id, user_id, media_url, content_type, media_format,
      file_size_bytes, video_duration_sec)
    values (
      (v_upload->>'id')::uuid, v_album_id, v_user_id,
      v_upload->>'media_url', v_upload->>'content_type', v_upload->>'media_format',
      (v_upload->>'file_size_bytes')::bigint, nullif(v_upload->>'video_duration_sec', '')::integer)
    returning id into v_upload_id;

    v_result := array_append(v_result, v_upload_id);
  end loop;

  return v_result;
end;
$$;

revoke all on function public.start_topic_album_upload_batch(uuid, jsonb) from public;
grant execute on function public.start_topic_album_upload_batch(uuid, jsonb) to authenticated;

-- SC-09/C-24: only the event's creator (explore_events.host_user_id, an
-- existing column -- see repo CLAUDE.md, "host" DB columns stay as-is, only
-- UI copy/new naming avoids the word) can flip the room's album on/off.
create or replace function public.set_topic_album_enabled(p_topic_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_user_id uuid := auth.uid();
  v_host uuid;
begin
  if v_user_id is null then
    raise exception 'Not signed in';
  end if;
  select e.host_user_id into v_host
  from community_topics t
  join explore_events e on e.id = t.explore_event_id
  where t.id = p_topic_id;
  if v_host is null then
    raise exception 'not an event room';
  end if;
  if v_host <> v_user_id then
    raise exception 'Only the creator can change this' using errcode = 'insufficient_privilege';
  end if;
  update community_topics set album_enabled = p_enabled where id = p_topic_id;
end;
$$;

revoke all on function public.set_topic_album_enabled(uuid, boolean) from public;
grant execute on function public.set_topic_album_enabled(uuid, boolean) to authenticated;

create or replace function public.soft_delete_topic_album_upload(p_upload_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Not signed in'; end if;
  update community_topic_album_uploads
  set deleted_at = now()
  where id = p_upload_id and user_id = v_user_id and deleted_at is null;
  if not found then raise exception 'upload not found or not yours'; end if;
end; $$;

revoke all on function public.soft_delete_topic_album_upload(uuid) from public;
grant execute on function public.soft_delete_topic_album_upload(uuid) to authenticated;

insert into storage.buckets (id, name, public)
values ('topic-album-media', 'topic-album-media', false)
on conflict (id) do nothing;

create policy "topic members can upload to topic-album-media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'topic-album-media'
    and (storage.foldername(name))[2] = auth.uid()::text
    and is_topic_member(((storage.foldername(name))[1])::uuid, auth.uid())
    -- SC-09/C-24: same album on/off + archived hard-stop gate as the RPC
    -- above, enforced again here since storage uploads can bypass the RPC.
    and exists (
      select 1 from community_topics t
      where t.id = ((storage.foldername(name))[1])::uuid
        and t.album_enabled
        and not t.archived
    )
  );

create policy "topic members can read topic-album-media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'topic-album-media'
    -- soft-deleting the DB row (soft_delete_topic_album_upload) must also
    -- revoke read access to the underlying file, or a "deleted" photo stays
    -- fetchable by any topic member who still has/derives the storage path
    and exists (
      select 1 from community_topic_album_uploads u
      where u.id::text = (storage.foldername(name))[3]
        and u.deleted_at is null
    )
    and exists (
      select 1 from community_topics t
      where t.id::text = (storage.foldername(name))[1]
        and (
          is_community_member(t.community_id, auth.uid())
          or (t.explore_event_id is not null and is_topic_member(t.id, auth.uid()))
        )
    )
  );

create policy "users delete own topic-album-media objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'topic-album-media' and (storage.foldername(name))[2] = auth.uid()::text);

do $$
declare
  v_creator uuid;
  v_attendee uuid;
  v_outsider uuid;
  v_cid uuid;
  v_eid uuid;
  v_topic_id uuid;
  v_grant_id uuid;
  v_upload_id uuid;
  v_upload_ids uuid[];
  v_raised boolean;
  v_count int;
  v_media_id uuid;
begin
  select id into v_creator from auth.users u
  where not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_attendee from auth.users u
  where u.id <> v_creator
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_outsider from auth.users u
  where u.id not in (v_creator, v_attendee)
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  if v_creator is null or v_attendee is null or v_outsider is null then
    raise exception 'SELF-TEST FAIL: needs three existing non-admin users';
  end if;

  insert into public.communities (handle, name, created_by, status)
  values ('selftest-topic-albums', 'Topic Albums Selftest', v_creator, 'active')
  returning id into v_cid;
  insert into public.community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_creator, 'leader', 'active', now() - interval '1 hour');
  insert into public.operator_grants (user_id, track, status, application)
  values (v_creator, 'community_leader', 'approved', '{}'::jsonb)
  returning id into v_grant_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  v_eid := public.operator_create_explore_event(
    p_title => 'Selftest Album Event',
    p_event_date => to_char(current_date + 7, 'YYYY-MM-DD'),
    p_category => 'community',
    p_community_id => v_cid
  );
  select id into v_topic_id from public.community_topics where explore_event_id = v_eid;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attendee, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.explore_event_rsvps (explore_event_id, user_id) values (v_eid, v_attendee);
  reset role;
  if not exists (select 1 from public.community_topic_members where topic_id = v_topic_id and user_id = v_attendee) then
    raise exception 'SELF-TEST FAIL: attendee not seated (event chat model prerequisite broken)';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.start_topic_album_upload_batch(v_topic_id,
      jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text, 'content_type', 'photo', 'media_format', 'jpg',
        'file_size_bytes', 1000,
        'media_url', v_topic_id::text || '/' || v_outsider::text || '/x/photo.jpg'
      )));
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a non-member uploaded to the topic album';
  end if;

  -- SC-09/C-24 album on/off: defaults false, and even a real topic member
  -- cannot upload until the creator turns it on.
  if (select album_enabled from community_topics where id = v_topic_id) is distinct from false then
    raise exception 'SELF-TEST FAIL: album_enabled did not default to false';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attendee, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.start_topic_album_upload_batch(v_topic_id,
      jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text, 'content_type', 'photo', 'media_format', 'jpg',
        'file_size_bytes', 1000,
        'media_url', v_topic_id::text || '/' || v_attendee::text || '/' || (gen_random_uuid()::text) || '/photo.jpg'
      )));
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a member uploaded while album_enabled was still false';
  end if;

  -- only the creator (event host_user_id) may flip the toggle
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.set_topic_album_enabled(v_topic_id, true);
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a non-member enabled the album toggle';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attendee, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.set_topic_album_enabled(v_topic_id, true);
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a non-creator member enabled the album toggle';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_topic_album_enabled(v_topic_id, true);
  reset role;
  if (select album_enabled from community_topics where id = v_topic_id) is distinct from true then
    raise exception 'SELF-TEST FAIL: creator enable did not take';
  end if;

  -- pre-existing bug caught here (never run against a real database before
  -- today): the id field and the media_url's own upload-id path segment
  -- must be the SAME value -- two independent gen_random_uuid() calls
  -- almost never match, which would make every real client upload fail this
  -- exact check too. Fixed by computing the id once and reusing it.
  v_media_id := gen_random_uuid();
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attendee, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_upload_ids := public.start_topic_album_upload_batch(v_topic_id,
    jsonb_build_array(jsonb_build_object(
      'id', v_media_id::text, 'content_type', 'photo', 'media_format', 'jpg',
      'file_size_bytes', 1000,
      'media_url', v_topic_id::text || '/' || v_attendee::text || '/' || v_media_id::text || '/photo.jpg'
    )));
  reset role;
  if array_length(v_upload_ids, 1) <> 1 then
    raise exception 'SELF-TEST FAIL: expected exactly one upload id back';
  end if;
  v_upload_id := v_upload_ids[1];
  if not exists (select 1 from public.community_topic_album_uploads where id = v_upload_id and user_id = v_attendee) then
    raise exception 'SELF-TEST FAIL: upload row missing after batch insert';
  end if;
  if not exists (select 1 from public.community_topic_albums where topic_id = v_topic_id) then
    raise exception 'SELF-TEST FAIL: album row was not created for the topic';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attendee, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.start_topic_album_upload_batch(v_topic_id,
      jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text, 'content_type', 'photo', 'media_format', 'jpg',
        'file_size_bytes', 1000,
        'media_url', v_topic_id::text || '/' || v_creator::text || '/x/photo.jpg'
      )));
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a spoofed user-id path segment was accepted';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.community_topic_album_uploads
  where topic_album_id in (select id from public.community_topic_albums where topic_id = v_topic_id);
  reset role;
  if v_count <> 1 then
    raise exception 'SELF-TEST FAIL: creator could not read the topic album (expected 1 row, got %)', v_count;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.community_topic_album_uploads
  where topic_album_id in (select id from public.community_topic_albums where topic_id = v_topic_id);
  reset role;
  if v_count <> 0 then
    raise exception 'SELF-TEST FAIL: an outsider could read the topic album via RLS';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.soft_delete_topic_album_upload(v_upload_id);
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a non-owner soft-deleted someone else''s upload';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attendee, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.soft_delete_topic_album_upload(v_upload_id);
  reset role;
  if not exists (select 1 from public.community_topic_album_uploads where id = v_upload_id and deleted_at is not null) then
    raise exception 'SELF-TEST FAIL: owner soft-delete did not take';
  end if;

  -- this check must run AS a real member (through RLS), not as the
  -- role-reset bypass role above, or it always finds the row (it still
  -- physically exists, only deleted_at changed) and the self-test would
  -- fail even when the select policy's own "deleted_at is null" clause
  -- (see community_topic_album_uploads_select) works correctly.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.community_topic_album_uploads
  where topic_album_id in (select id from public.community_topic_albums where topic_id = v_topic_id);
  reset role;
  if v_count <> 0 then
    raise exception 'SELF-TEST FAIL: soft-deleted upload still visible via the select policy';
  end if;

  if not exists (select 1 from storage.buckets where id = 'topic-album-media' and public = false) then
    raise exception 'SELF-TEST FAIL: topic-album-media bucket missing or not private';
  end if;

  -- SC-08/SC-09/C-24 hard stop: once the room is archived (same flag the
  -- event_end+48h cron sets, same one chat already enforces), new uploads
  -- are blocked server-side even though album_enabled is still true.
  update public.community_topics set archived = true where id = v_topic_id;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attendee, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.start_topic_album_upload_batch(v_topic_id,
      jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text, 'content_type', 'photo', 'media_format', 'jpg',
        'file_size_bytes', 1000,
        'media_url', v_topic_id::text || '/' || v_attendee::text || '/' || (gen_random_uuid()::text) || '/photo.jpg'
      )));
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: uploaded to an archived (hard-stopped) room';
  end if;

  -- viewing stays available after hard stop, same parity as chat history --
  -- only new uploads are blocked, existing photos are untouched
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.community_topic_album_uploads
  where topic_album_id in (select id from public.community_topic_albums where topic_id = v_topic_id);
  reset role;
  if v_count <> 0 then
    raise exception 'SELF-TEST FAIL: expected 0 visible uploads at this point (prior one was soft-deleted), got %', v_count;
  end if;

  delete from public.community_topic_album_uploads where topic_album_id in (
    select id from public.community_topic_albums where topic_id = v_topic_id);
  delete from public.community_topic_albums where topic_id = v_topic_id;
  delete from public.explore_event_rsvps where explore_event_id = v_eid;
  delete from public.explore_events where id = v_eid;
  delete from public.operator_grants where id = v_grant_id;
  delete from public.communities where id = v_cid;

  raise notice 'event chat albums self-test passed';
end;
$$;

commit;
