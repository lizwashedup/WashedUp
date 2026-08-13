-- Office scaffold Phase 3: Systems page needs the `tools` table widened to
-- match washedup-world's already-live, richer static page (25 real services
-- with description/longDescription/favicon/bgColor/note/updates[]), not
-- command-center-next's thinner original shape.

BEGIN;

ALTER TABLE tools
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS long_description text,
  ADD COLUMN IF NOT EXISTS favicon_domain text,
  ADD COLUMN IF NOT EXISTS bg_color text,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS cost_display text;

-- cost_display preserves free-text cost strings ("~$12", "?", "Free") exactly
-- as washedup-world's UI renders them today. The existing `cost numeric`
-- column can't hold those, so it stays for a clean parsed number where one
-- exists, and cost_display is what the page actually reads for rendering.

-- Widen billing to washedup-world's BillingCycle (monthly/yearly/one-time/
-- free/usage/unknown) instead of command-center-next's 3-value
-- monthly/annual/one-time. No existing CHECK constraint is assumed here;
-- if one exists it must be dropped/redefined separately before this lands.
ALTER TABLE tools ALTER COLUMN billing SET DEFAULT 'monthly';

CREATE TABLE IF NOT EXISTS tool_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id uuid REFERENCES tools(id) ON DELETE CASCADE,
  note_date date NOT NULL,
  text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE tool_updates ENABLE ROW LEVEL SECURITY;
-- No policies: read/write via washedup-world's service-role API routes only.

COMMIT;
