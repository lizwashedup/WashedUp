-- Office scaffold Phase 3: Finance page needs a real table. Today it's a
-- 61-row hardcoded SEED array in command-center-next with zero persistence.
-- washedup-world's /finance is a bare stub. This is a genuine new table,
-- not a port -- nothing today persists this data anywhere.

BEGIN;

CREATE TABLE IF NOT EXISTS finance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_date date NOT NULL,
  description text NOT NULL,
  amount numeric NOT NULL,              -- negative = refund
  category text NOT NULL,
  source text NOT NULL,                 -- 'Credit Card' | 'Personal Card' | 'Business Checking' | 'Checking'
  card_last4 text,
  notes text,
  tax_deductible boolean DEFAULT false,
  recurring boolean DEFAULT false,
  vendor_url text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;
-- No policies: washedup-world's API routes read/write via the service-role
-- client only (same pattern as tasks/growth_cards/investors/strategy_answers/
-- documents), so RLS with zero policies is the correct default-deny posture.

COMMIT;
