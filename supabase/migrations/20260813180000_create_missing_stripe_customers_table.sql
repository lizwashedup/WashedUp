-- stripe_customers was referenced by create-checkout-session and stripe-webhook
-- (both live edge functions) but the table itself was never created. Every
-- contributor-paywall checkout attempt has been hard-failing with a 500 since
-- create-checkout-session went live (confirmed: relation does not exist).
-- Schema mirrors organizer_stripe_accounts' existing convention exactly
-- (PK on user_id -> profiles cascade, unique + format-checked Stripe id,
-- RLS on with zero policies so only service_role, which both callers use,
-- can touch it).

create table if not exists stripe_customers (
  user_id uuid primary key references profiles(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_customers_cus_format check (
    stripe_customer_id like 'cus\_%' escape '\'
    and char_length(stripe_customer_id) between 6 and 255
  )
);

alter table stripe_customers enable row level security;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'stripe_customers'
  ) then
    raise exception 'self-test failed: stripe_customers table was not created';
  end if;
end $$;
