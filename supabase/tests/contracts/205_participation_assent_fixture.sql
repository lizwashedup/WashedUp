-- Isolated database only. The cluster may have roles from other contract lanes.
do $$ begin
  if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
end $$;
create schema auth;
grant usage on schema auth to authenticated;
create function auth.uid() returns uuid language sql stable as $$
  select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid
$$;
create type app_role as enum('admin');
create function is_admin(uuid) returns boolean language sql stable as $$select false$$;
create function has_role(uuid,app_role) returns boolean language sql stable as $$select false$$;
