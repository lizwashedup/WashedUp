-- Exact client-request receipts for read-only refund recovery. No money math,
-- financial RPC, authority policy, provider mode or scheduler is changed.
begin;
create table public.ticket_refund_requests (
  request_id uuid primary key,
  order_id uuid not null references public.ticket_orders(id),
  requester_user_id uuid not null,
  target_hash text not null check (target_hash ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('pending', 'confirmed', 'complete', 'not_started')),
  stripe_refund_id text,
  refund_amount_cents bigint,
  positions_voided integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (refund_amount_cents is null or refund_amount_cents >= 0),
  check (positions_voided is null or positions_voided >= 0),
  check (state not in ('confirmed', 'complete') or nullif(stripe_refund_id, '') is not null),
  check (state <> 'complete' or (refund_amount_cents is not null and positions_voided is not null)),
  check (state <> 'not_started' or stripe_refund_id is null)
);
comment on table public.ticket_refund_requests is 'Private original refund request receipts; terminal outcomes retained. Missing receipt never authorizes another refund.';
-- Keep financial request provenance even if the requester account is removed.
-- Order history is already retained; no new cascading deletion is introduced.
alter table public.ticket_refund_requests enable row level security;
revoke all on public.ticket_refund_requests from public, anon, authenticated, service_role;
grant select, insert, update on public.ticket_refund_requests to service_role;
commit;
