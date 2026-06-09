-- Circle-aware plans. 1/4: additive columns on events.
--
-- REVIEW ONLY. Not applied by the agent. Verified 2026-06-09 against project
-- upstjumasqblszevlgik (prod). Circles infra (circles, circle_members,
-- is_circle_member, polymorphic messages.circle_id) is already LIVE on prod;
-- this chunk only adds the plan side.
--
-- A circle plan is a REAL events row (not a duplicate). These four columns are
-- the only schema additions; every existing and future NORMAL plan has
-- circle_id IS NULL and is completely untouched by them.
--
--   circle_id          NULL  -> normal plan. NOT NULL -> a circle plan.
--                      ON DELETE SET NULL (not CASCADE): deleting a circle must
--                      never destroy a real plan + its members + its chat
--                      history. Mirrors circles.creator_user_id's SET NULL.
--   circle_visibility  'circle_only' (stays inside the circle, never in the
--                      public feed) | 'open' (posts to the public Plans feed).
--   stranger_cap       Open plans only: how many feed strangers may join
--                      (2..7). Circle members are excluded from this cap and
--                      stack on top, so total attendance can exceed 8. NULL for
--                      normal + circle_only plans.
--   has_own_chat       Whether coordination lives in an EVENT-parented chat.
--                      true for every normal plan (no backfill) and for open /
--                      picked-subset circle plans; false only for a whole-circle
--                      just-us plan (which lives in the circle chat). The
--                      "Start a chat for this" affordance flips it false->true.
--
-- CHECK is guarded on circle_id IS NOT NULL only. The normal/orphaned branch is
-- intentionally unconstrained so an ON DELETE SET NULL (circle_id -> NULL while
-- leftover circle_visibility/stranger_cap remain) never violates it on a later
-- UPDATE. has_own_chat is intentionally outside the CHECK so the Start-a-chat
-- flip never trips it.
--
-- Idempotent. Wrapped BEGIN/COMMIT with a self-test that asserts the columns,
-- the CHECK, and the index landed (DDL-only migration; the behavioral
-- smoke-call lives in 3/4 create_circle_plan).

BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS circle_id uuid REFERENCES public.circles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS circle_visibility text,
  ADD COLUMN IF NOT EXISTS stranger_cap integer,
  ADD COLUMN IF NOT EXISTS has_own_chat boolean NOT NULL DEFAULT true;

-- Guarded ADD CONSTRAINT (Postgres has no ADD CONSTRAINT IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass AND conname = 'events_circle_shape'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_circle_shape CHECK (
        circle_id IS NULL
        OR (
          circle_visibility IN ('circle_only','open')
          AND (
            (circle_visibility = 'open'        AND stranger_cap BETWEEN 2 AND 7)
         OR (circle_visibility = 'circle_only' AND stranger_cap IS NULL)
          )
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_circle
  ON public.events (circle_id) WHERE circle_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Self-test: the four columns, the CHECK, and the index exist; has_own_chat is
-- NOT NULL DEFAULT true so every existing row reads true with no backfill.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_col text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['circle_id','circle_visibility','stranger_cap','has_own_chat']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='events' AND column_name=v_col
    ) THEN
      RAISE EXCEPTION 'events.% missing', v_col;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='events'
      AND column_name='has_own_chat' AND is_nullable='YES'
  ) THEN
    RAISE EXCEPTION 'events.has_own_chat must be NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.events'::regclass AND conname='events_circle_shape'
  ) THEN
    RAISE EXCEPTION 'events_circle_shape constraint missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='events' AND indexname='idx_events_circle'
  ) THEN
    RAISE EXCEPTION 'idx_events_circle missing';
  END IF;
END $$;

COMMIT;
