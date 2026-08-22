-- ============================================================================
-- add 'withdrawn' to operator_grant_status (inventory S-01: applicant
-- self-withdraw is one of the 8 spec states, and is genuinely missing --
-- do not confuse with 'revoked', which is platform-initiated).
--
-- Split into its own migration, applied before the RPC that uses the new
-- value (20260819020000): ALTER TYPE ... ADD VALUE cannot safely be used in
-- the same transaction as code that references the new value.
--
-- ADDITIVE ONLY. NOT applied anywhere -- written 2026-08-19.
-- ============================================================================

alter type public.operator_grant_status add value if not exists 'withdrawn';
