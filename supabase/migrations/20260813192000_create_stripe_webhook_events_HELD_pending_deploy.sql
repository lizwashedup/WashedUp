-- HELD, DO NOT APPLY without first deploying the test/live key gate to
-- stripe-webhook (matching the gate create-checkout-session, cancel-my-
-- membership, and cancel-contributor-subscription already have via
-- stripeKeyIsTest() in _shared/contributor.ts). stripe-webhook currently
-- has no such gate. The moment this table exists, the function stops
-- 500ing on every event and Stripe replays whatever it has queued and
-- retried over the last 3 days for real: confirmation emails via Resend,
-- stripe.subscriptions.cancel in the kicked-member path, stripe.refunds.create
-- in the founding-overcap path. Josh's instruction (2026-08-13): assume the
-- key behind this function is the real one, nothing may affect a real
-- person without an explicit go. Apply only after the gated function deploy
-- lands and is confirmed live, or after Josh otherwise explicitly clears it.

create table public.stripe_webhook_events (
  id text primary key
    constraint stripe_webhook_events_evt_format
    check (id like 'evt\_%' escape '\' and char_length(id) between 6 and 255),
  type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.stripe_webhook_events enable row level security;
revoke all on table public.stripe_webhook_events from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'stripe_webhook_events' and c.relkind = 'r'
  ) then
    raise exception 'self-test failed: stripe_webhook_events not created';
  elsif not (select relrowsecurity from pg_class where relname = 'stripe_webhook_events' and relnamespace = 'public'::regnamespace) then
    raise exception 'self-test failed: RLS not enabled on public.stripe_webhook_events';
  elsif exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'stripe_webhook_events' and grantee in ('anon','authenticated','PUBLIC')
  ) then
    raise exception 'self-test failed: anon/authenticated/public still has a grant on public.stripe_webhook_events';
  end if;
end $$;
