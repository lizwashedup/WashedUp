\set ON_ERROR_STOP on

CREATE SCHEMA auth;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY
);

-- Stand-in for the real ticket_payouts table: no local CREATE TABLE exists
-- anywhere in this repo's tracked migrations (confirmed drift, same pattern
-- as organizer_receivables), but this shape is corroborated from source,
-- not guessed: matches supabase/tests/contracts/40_payout_claim_fixture.sql
-- and the real INSERT/UPDATE column lists in
-- 20260816120000_claim_ticket_payout_batch_atomic.sql and
-- supabase/functions/ticket-payout-release/index.ts.
CREATE TABLE public.ticket_payouts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  organizer_user_id uuid NOT NULL,
  stripe_account_id_snapshot text NOT NULL,
  amount_cents integer NOT NULL,
  status text NOT NULL,
  failure_message text,
  stripe_payout_id text,
  released_at timestamptz
);

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-000000000001'), -- blocked_organizer: owed money, still pending
  ('00000000-0000-0000-0000-000000000002'), -- paid_organizer: fully released history
  ('00000000-0000-0000-0000-000000000003'), -- never_organizer: no payout rows at all
  ('00000000-0000-0000-0000-000000000004'), -- zero_amount_organizer: pending but $0 row
  ('00000000-0000-0000-0000-000000000005'), -- transitioning_organizer: starts pending, marked released mid-contract
  ('00000000-0000-0000-0000-000000000006'); -- failed_organizer: a failed (not merely pending) payout still owed

INSERT INTO public.ticket_payouts
  (event_id, organizer_user_id, stripe_account_id_snapshot, amount_cents, status, failure_message, stripe_payout_id, released_at)
VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'acct_test1', 5000, 'pending', NULL, NULL, NULL),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'acct_test2', 3000, 'released', NULL, 'po_settled_already', now()),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 'acct_test4', 0, 'pending', NULL, NULL, NULL),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000005', 'acct_test5', 7500, 'pending', NULL, NULL, NULL),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006', 'acct_test6', 4000, 'failed', 'balance_insufficient', NULL, NULL);
