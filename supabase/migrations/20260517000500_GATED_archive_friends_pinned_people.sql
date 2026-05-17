-- Yours page rebuild — 6/6: GATED destructive archive of the legacy
-- friends / pinned_people system.
--
-- ############################################################
-- #  DO NOT APPLY UNTIL FLIP TIME.                            #
-- #  Apply ONLY when YOURS_PAGE_ENABLED is being flipped true #
-- #  in a shipped build. Remove the guard block below by hand #
-- #  at that moment, never before.                            #
-- ############################################################
--
-- Per the product spec the fresh start is intentional: "All existing Your
-- People data is wiped. Every user starts fresh. This is treated as an
-- upgrade moment, not a loss." So there is deliberately NO backfill into
-- people_connections. Data is preserved by RENAME (not DROP) for rollback.
--
-- Post-flip the legacy RPCs add_friend / remove_friend /
-- get_people_with_plan_history reference `friends` and will error if
-- called. That is expected: the legacy screen that calls them is no longer
-- mounted once the flag is true. They are intentionally left in place
-- (not dropped) so a flag rollback restores the old experience.
--
-- REVIEW ONLY. Not applied by the agent.

-- ---- ACCIDENTAL-APPLY GUARD (remove this whole DO block only at flip) ----
DO $$
BEGIN
  RAISE EXCEPTION
    'GATED MIGRATION: remove the guard block only when flipping YOURS_PAGE_ENABLED';
END $$;
-- ---- END GUARD ----------------------------------------------------------

BEGIN;

ALTER TABLE IF EXISTS public.friends
  RENAME TO friends_archived_20260517;
ALTER TABLE IF EXISTS public.pinned_people
  RENAME TO pinned_people_archived_20260517;

-- Lock the archived tables down: read-only historical record.
REVOKE INSERT, UPDATE, DELETE
  ON public.friends_archived_20260517 FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE
  ON public.pinned_people_archived_20260517 FROM anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.friends') IS NOT NULL
     OR to_regclass('public.pinned_people') IS NOT NULL THEN
    RAISE EXCEPTION 'self-test: legacy tables still present after archive';
  END IF;
  IF to_regclass('public.friends_archived_20260517') IS NULL
     OR to_regclass('public.pinned_people_archived_20260517') IS NULL THEN
    RAISE EXCEPTION 'self-test: archived tables missing';
  END IF;
END $$;

COMMIT;
