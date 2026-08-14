-- The contributor-paywall lane (stripe-webhook, create-checkout-session,
-- cancel-my-membership, cancel-contributor-subscription, _shared/contributor.ts)
-- has been deployed and live since 2026-07-13/31 but tables it depends on
-- were never created anywhere (confirmed live via pg_class, not just missing
-- from this repo's migration history). Every column below is taken directly
-- from real read/insert/update calls against these tables in the four
-- functions above, not invented.
--
-- Split from the original 3-table version 2026-08-13: stripe_webhook_events
-- moved OUT to its own migration (20260813192000, held unapplied) because
-- creating it flips the already-deployed, already-live stripe-webhook
-- function from erroring harmlessly to actively processing whatever Stripe
-- has queued and retried for up to 3 days, real emails/cancels/refunds, and
-- that function has no test/live key gate the way its siblings do. Josh's
-- instruction: assume the live key is real, nothing may affect a real
-- person without an explicit go. These two tables are safe to create now:
-- neither has a write path reachable while create-checkout-session's own
-- existing test-mode gate stays in place.
--
-- Two more related gaps are deliberately NOT addressed here: consent_evidence
-- (checkout's own comments say it's parked pending a separate numbered
-- proposal, and every write to it already has a warn-and-continue fallback)
-- and the acquire_founding_slot RPC (missing, but create-checkout-session
-- already catches that and falls back to the regular-price offer, so nothing
-- hard-fails). No CREATE TABLE IF NOT EXISTS: prior review on this same
-- table set proved that pattern can silently no-op against a differently
-- shaped pre-existing table while still reporting success, so a plain
-- CREATE TABLE aborts loudly instead if either of these turn out to already
-- exist in some shape we don't expect.

create table public.contributor_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  stripe_subscription_id text not null unique
    constraint contributor_subscriptions_sub_format
    check (stripe_subscription_id like 'sub\_%' escape '\' and char_length(stripe_subscription_id) between 6 and 255),
  stripe_price_id text,
  status text not null
    constraint contributor_subscriptions_status_values
    check (status in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);
create index contributor_subscriptions_user_id_idx on public.contributor_subscriptions (user_id);
alter table public.contributor_subscriptions enable row level security;
revoke all on table public.contributor_subscriptions from public, anon, authenticated;

create table public.contributor_founding_grants (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.contributor_founding_grants enable row level security;
revoke all on table public.contributor_founding_grants from public, anon, authenticated;

do $$
declare
  v_missing text[];
  t text;
begin
  foreach t in array array['contributor_subscriptions','contributor_founding_grants']
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      v_missing := array_append(v_missing, t);
    elsif not (select relrowsecurity from pg_class where relname = t and relnamespace = 'public'::regnamespace) then
      raise exception 'self-test failed: RLS not enabled on public.%', t;
    elsif exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public' and table_name = t and grantee in ('anon','authenticated','PUBLIC')
    ) then
      raise exception 'self-test failed: anon/authenticated/public still has a grant on public.%', t;
    end if;
  end loop;
  if array_length(v_missing, 1) > 0 then
    raise exception 'self-test failed: table(s) not created: %', array_to_string(v_missing, ', ');
  end if;
end $$;
