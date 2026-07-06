-- ============================================================================
-- community-media storage bucket: images for community page blocks (cover
-- carousel, gallery, header logo). Mirrors the circle-covers pattern exactly:
-- public read, writes folder-scoped to the community id in the object path,
-- gated by is_community_leader (leaders and co-leaders only, probe-guarded).
-- HELD: committed on feature/communities, NOT applied; proposed for Cowork
-- review, rides the next migration batch with the join-flow riders. Until it
-- applies, the RN block editor's photo upload fails with a friendly error and
-- every non-image editor path still works.
-- Additive only: new bucket, new storage.objects policies, nothing existing
-- touched.
-- ============================================================================

begin;

insert into storage.buckets (id, name, public)
values ('community-media', 'community-media', true)
on conflict (id) do nothing;

-- public read (bucket is public; the select policy keeps the API path open)
create policy "community media read"
on storage.objects for select
using (bucket_id = 'community-media');

-- leaders write into their own community's folder: path = <community_id>/<file>
create policy "community media leader insert"
on storage.objects for insert
with check (
  bucket_id = 'community-media'
  and is_community_leader(((storage.foldername(name))[1])::uuid, auth.uid())
);

create policy "community media leader update"
on storage.objects for update
using (
  bucket_id = 'community-media'
  and is_community_leader(((storage.foldername(name))[1])::uuid, auth.uid())
);

create policy "community media leader delete"
on storage.objects for delete
using (
  bucket_id = 'community-media'
  and is_community_leader(((storage.foldername(name))[1])::uuid, auth.uid())
);

-- in-transaction self-test (never strip on apply)
do $$
declare
  v_bucket_public boolean;
  v_policy_count integer;
begin
  select public into v_bucket_public from storage.buckets where id = 'community-media';
  if v_bucket_public is distinct from true then
    raise exception 'SELF-TEST FAIL: community-media bucket missing or not public';
  end if;

  select count(*) into v_policy_count
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'objects'
    and p.polname like 'community media%';
  if v_policy_count <> 4 then
    raise exception 'SELF-TEST FAIL: expected 4 community media policies, found %', v_policy_count;
  end if;

  raise notice 'community media bucket self-test passed';
end;
$$;

commit;
