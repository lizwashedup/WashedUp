-- User-deletion FK gap, task #67.
--
-- Both self-serve deletion paths (supabase/functions/delete-user and
-- supabase/functions/delete-ghost-account) do exactly one thing to remove a
-- user: call auth.admin.deleteUser(user.id). Neither enumerates tables, so
-- cleanup only happens where a FOREIGN KEY ... ON DELETE rule makes it happen.
-- profiles.id already carries FOREIGN KEY (id) REFERENCES auth.users(id)
-- ON DELETE CASCADE, which is how the covered tables get cleaned today.
--
-- The third path, admin_cascade_delete_user(p_user_id), is a hardcoded list of
-- seven DELETEs (messages, event_members, chat_reads, friends, reports, events,
-- profiles). It never touches auth.users, so it cannot help anything outside
-- that list either.
--
-- Live-confirmed 2026-08-15: these three tables hold a NOT NULL uuid column
-- pointing at a user and carry no foreign key on it, so no deletion path has
-- ever reached them:
--
--   user_roles.user_id                orphaned role/permission grants
--   email_verification_codes.user_id  PII retained past "deletion"
--   sms_verification_codes.user_id    PII retained past "deletion"
--
-- Orphan check run before writing this file: all three are at zero orphan rows
-- against both auth.users and profiles, so every constraint below validates
-- against existing data with no cleanup step.
--
-- Anchor is auth.users(id), not profiles(id): that matches the one existing
-- user-reference FK in this schema (moderation_actions.performed_by REFERENCES
-- auth.users(id) ON DELETE SET NULL) and it is the table the deletion paths
-- actually delete from. All three columns are NOT NULL, so ON DELETE SET NULL
-- is not available for any of them without a separate schema change.
--
-- organizer_receivables.organizer_user_id is a fourth table with the same gap
-- but is DELIBERATELY NOT covered here: it is a money ledger and the correct
-- ON DELETE behavior (RESTRICT vs a settled/unsettled split) is a product call
-- for Josh/Liz, not a cleanup. Tracked separately, not in this file.
--
-- Deliberately NOT covered here either. These also lack a user FK and that is
-- correct for them, they are meant to outlive the user for audit/legal
-- reasons: deleted_users (tombstone table), moderation_actions.target_user_id
-- (note performed_by on the same table already has a SET NULL FK),
-- creator_terms_acceptances, member_terms_acceptances,
-- participation_notice_assents (legal acceptance evidence). chat_reads and
-- reports are also FK-less but are already deleted by hand inside
-- admin_cascade_delete_user, a separate inconsistency, not this file's job.

BEGIN;

-- 1. user_roles: a role grant is meaningless without the user, and leaving it
-- behind is the security concern. Cascade lookups are already served by
-- user_roles_user_id_role_key, whose leading column is user_id.
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. email_verification_codes: short-lived PII whose reason to exist ends with
-- the account. No index on user_id existed (pkey only), so the cascade would
-- seq-scan on every user deletion.
CREATE INDEX IF NOT EXISTS email_verification_codes_user_id_idx
  ON public.email_verification_codes (user_id);

ALTER TABLE public.email_verification_codes
  ADD CONSTRAINT email_verification_codes_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. sms_verification_codes: same as above, phone numbers.
CREATE INDEX IF NOT EXISTS sms_verification_codes_user_id_idx
  ON public.sms_verification_codes (user_id);

ALTER TABLE public.sms_verification_codes
  ADD CONSTRAINT sms_verification_codes_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Self-test: prove all three constraints exist AND carry the exact ON DELETE
-- action intended. Comparing the full definition string, not just presence,
-- so a constraint that lands with the wrong action still fails the migration.
DO $$
DECLARE
  r record;
  v_def text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('user_roles',
       'user_roles_user_id_fkey',
       'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
      ('email_verification_codes',
       'email_verification_codes_user_id_fkey',
       'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
      ('sms_verification_codes',
       'sms_verification_codes_user_id_fkey',
       'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE')
    ) AS t(tbl, con, expected)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public'
      AND rel.relname = r.tbl
      AND c.conname = r.con
      AND c.contype = 'f';

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'self-test failed: constraint % is missing on %', r.con, r.tbl;
    END IF;

    IF v_def <> r.expected THEN
      RAISE EXCEPTION 'self-test failed: % on % is "%", expected "%"',
        r.con, r.tbl, v_def, r.expected;
    END IF;

    RAISE NOTICE 'ok: %.% -> %', r.tbl, r.con, v_def;
  END LOOP;
END $$;

COMMIT;
