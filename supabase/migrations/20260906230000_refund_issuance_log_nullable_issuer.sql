-- DRAFT: DO NOT APPLY WITHOUT JOSH'S WORD.
--
-- Fix: refund_issuance_log.issued_by_user_id (20260904010000_refund_authority_grants.sql)
-- is declared `NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL` -- a real
-- contradiction. Once ANY refund has ever been logged for a user, Postgres cannot
-- honor ON DELETE SET NULL on that row (it would have to write NULL into a NOT NULL
-- column), so deleting that user's account fails outright instead of anonymizing the
-- row the way the FK action says it should. The read side already expected this:
-- lib/refundAuthority.ts's listCommunityRefundIssuanceLog falls back to a plain
-- 'Someone' display name whenever no profile row is found for issued_by_user_id,
-- which only ever makes sense if that column can legitimately be null.
--
-- This migration ONLY drops the column-level NOT NULL. Nothing else about the table
-- changes:
--   * The FK itself (REFERENCES auth.users(id) ON DELETE SET NULL) is untouched --
--     it was already correct, it just could never fire.
--   * The table's own CHECK (issuer_is_owner OR reason IS NOT NULL) is untouched --
--     a separate, correct rule about REASON, not about who issued it, and insert-time
--     behavior is unaffected: record_refund_issuance() is always called with a real,
--     freshly-authenticated caller id (never null) as p_issued_by_user_id, so no
--     legitimate insert ever wanted a null issuer. This migration only lets a row
--     that ALREADY EXISTS anonymize its issuer after that user's account is deleted,
--     exactly what ON DELETE SET NULL was written to do.
--
-- NOT applied anywhere, NOT run against a live or disposable Postgres this session
-- (no working harness -- same caveat as recent same-night migrations in this repo).
-- Needs a real apply-and-test pass and Josh's explicit go before this can ever be
-- called done, per this repo's own Release Discipline (clients/washed-up/CLAUDE.md).

BEGIN;

ALTER TABLE public.refund_issuance_log
  ALTER COLUMN issued_by_user_id DROP NOT NULL;

COMMENT ON COLUMN public.refund_issuance_log.issued_by_user_id IS
  'Nullable (fixed 2026-09-06): ON DELETE SET NULL on the auth.users FK can only fire once this column allows null. A null value means the issuing account was later deleted; the read side (lib/refundAuthority.ts) already renders that case as a plain "Someone".';

-- ---------------------------------------------------------------------------
-- self-test: the invariant this migration exists to establish (never strip on apply)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_is_nullable text;
BEGIN
  SELECT is_nullable INTO v_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'refund_issuance_log'
    AND column_name = 'issued_by_user_id';

  IF v_is_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION
      'SELF-TEST FAIL: refund_issuance_log.issued_by_user_id is still NOT NULL (is_nullable=%)',
      v_is_nullable;
  END IF;

  -- the CHECK this migration deliberately leaves alone must still exist --
  -- this is not a stealth loosening of the reason requirement.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.refund_issuance_log'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%issuer_is_owner%reason%'
  ) THEN
    RAISE EXCEPTION
      'SELF-TEST FAIL: refund_issuance_log lost its issuer_is_owner/reason CHECK constraint';
  END IF;
END;
$$;

COMMIT;
