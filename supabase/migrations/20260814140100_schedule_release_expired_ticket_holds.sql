-- ============================================================================
-- FIX 4: schedule release_expired_ticket_holds -- NOT YET APPLIED
--
-- Live cron confirmed 2026-08-14: 3 ticketing jobs exist (47 ticket-inbox-drain
-- every minute, 51 ticket-inbox-age-watchdog */5, 53 ticket-payout-release
-- 0 */6). release_expired_ticket_holds is NOT among them and has no callers.
-- Naming and command style below match jobs 51 / 8 / 13 exactly.
-- ============================================================================


-- ── PART A (RECOMMENDED, apply this before Part B) ──────────────────────────
-- Scheduling the function EXACTLY as it stands today introduces a new money
-- bug that does not exist while it is unscheduled.
--
-- Today: a buyer who pays in the last seconds of the 35-minute window still
-- gets their ticket. Stripe never fires checkout.session.expired for a session
-- that was PAID, so the drain never cancels that order, and settle_ticket_hold
-- handles the already-dead hold correctly via its late-webhook rule.
--
-- With the function scheduled unchanged: the cron works purely off the DB
-- clock and cannot see that the session was paid. It cancels the pending order
-- while the checkout.session.completed webhook is still in flight. settle then
-- hits 'order ... is canceled -- cannot settle', which the drain treats as
-- TERMINAL. The buyer is charged, gets no ticket, and it is not even flagged
-- as refund owed.
--
-- The orders this safety net actually exists to rescue are the ones stranded
-- when the edge function died between creating the Stripe session and writing
-- the id back. Those orders have stripe_checkout_session_id IS NULL, and they
-- were never payable at all: the buyer never received a checkout url. Filtering
-- on that makes the cancel provably incapable of stranding money, while the
-- hold release (which is always safe, and is the part that frees inventory)
-- still runs for every expired hold.
--
-- CREATE OR REPLACE is enough here: the signature and return type are
-- unchanged, so the existing ACL (postgres=X, service_role=X) is preserved.

CREATE OR REPLACE FUNCTION public.release_expired_ticket_holds()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer; v_expired uuid[];
begin
  with upd as (
    update public.ticket_holds set status = 'released'
     where status = 'active' and expires_at <= now()
    returning id)
  select coalesce(array_agg(id), '{}'::uuid[]) into v_expired from upd;
  v_count := coalesce(array_length(v_expired, 1), 0);
  -- 2026-08-14: only orders that never received a Stripe session are canceled
  -- here. An order WITH a session id may have been paid seconds before its
  -- hold died, with its completed webhook still in flight; canceling that one
  -- makes settle_ticket_hold raise 'cannot settle' and the money is taken with
  -- no ticket and no refund flag. An order with a NULL session id was never
  -- payable, so canceling it can never strand money. Orders that DO have a
  -- session id are canceled by the drain's checkout.session.expired handler,
  -- which Stripe only fires when the session was not paid.
  update public.ticket_orders set status = 'canceled'
   where hold_id = any (v_expired) and status = 'pending'
     and stripe_checkout_session_id is null;
  return v_count;
end;
$function$;


-- ── PART B: the schedule ────────────────────────────────────────────────────
-- */5 matches the cadence of the other ticketing safety nets (job 51
-- ticket-inbox-age-watchdog, job 18 waitlist-exceptions-expire). Holds live 35
-- minutes, so 5 minutes is prompt without being busy. cron.schedule upserts on
-- the job name, so re-running this is safe.

select cron.schedule(
  'ticket-holds-release-expired',
  '*/5 * * * *',
  $$select public.release_expired_ticket_holds();$$
);


-- ── Verify ──────────────────────────────────────────────────────────────────
-- select jobid, jobname, schedule, active, command from cron.job
--  where jobname = 'ticket-holds-release-expired';
-- select status, return_message, start_time from cron.job_run_details
--  where jobid = (select jobid from cron.job where jobname='ticket-holds-release-expired')
--  order by start_time desc limit 5;


-- ── ALTERNATIVE, if Part A is rejected and the function must stay untouched ──
-- This is the literal "schedule it as-is" version. It carries the paid-in-the
-- -last-seconds race described above. Do not use both.
--
-- select cron.schedule(
--   'ticket-holds-release-expired',
--   '*/5 * * * *',
--   $$select public.release_expired_ticket_holds();$$
-- );
