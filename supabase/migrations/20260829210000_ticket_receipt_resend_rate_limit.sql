-- Server-enforced receipt resend cooldown. Client button state is not a
-- security boundary and resets on every screen visit.

BEGIN;

ALTER TABLE public.ticket_orders
  ADD COLUMN IF NOT EXISTS receipt_resend_last_requested_at timestamptz;

-- Even if a future buyer UPDATE policy is added to ticket_orders, only the
-- service-role endpoint may move this abuse-control timestamp.
CREATE OR REPLACE FUNCTION public.ticket_receipt_resend_cooldown_service_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.receipt_resend_last_requested_at IS DISTINCT FROM OLD.receipt_resend_last_requested_at
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'receipt resend cooldown is service managed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ticket_receipt_resend_cooldown_guard ON public.ticket_orders;
CREATE TRIGGER ticket_receipt_resend_cooldown_guard
  BEFORE UPDATE OF receipt_resend_last_requested_at ON public.ticket_orders
  FOR EACH ROW EXECUTE FUNCTION public.ticket_receipt_resend_cooldown_service_only();

CREATE INDEX IF NOT EXISTS idx_ticket_orders_receipt_resend_requested
  ON public.ticket_orders (receipt_resend_last_requested_at)
  WHERE receipt_resend_last_requested_at IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ticket_orders'
      AND column_name = 'receipt_resend_last_requested_at'
  ) THEN
    RAISE EXCEPTION 'ticket receipt resend cooldown column missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgname = 'ticket_receipt_resend_cooldown_guard'
      AND n.nspname = 'public'
      AND c.relname = 'ticket_orders'
      AND p.proname = 'ticket_receipt_resend_cooldown_service_only'
      AND t.tgenabled = 'O'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'ticket receipt resend cooldown guard missing or disabled';
  END IF;
END $$;

COMMIT;
