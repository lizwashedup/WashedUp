-- First-join system instrumentation + area wishlist demand signal (spec a2).
-- APPLIED to prod 2026-07-18 (Liz-approved, as written, self-test passed:
-- 2 tables, 5-value enum, RLS + 4 policies, touch trigger, no test rows left).
-- Runs in one transaction with an embedded self-test (house rule: never
-- strip the in-transaction self-test on apply).
--
-- Table 1: first_join_prompts. Every showing of the "your first week" cards
-- logs user_id + shown_event_ids + action, so first-week join conversion is
-- measurable per ranking weight (score_breakdowns snapshots the per-weight
-- contributions the ranking service computed at render time).
--
-- Table 2: area_wishlists. The "tell me when something opens near me"
-- raise-hand, one row per user (upsert on user_id = idempotent by
-- construction), with a neighborhood + vibe snapshot taken at tap time. This
-- exists because the existing `wishlists` table is the event-save feature
-- (user_id + event_id only, verified on prod 2026-07-16) and cannot hold an
-- area/vibe wish. Feeds the a4b creator-side demand surface and the step-3
-- new-plan-in-area notifier.

BEGIN;

-- ── Types ────────────────────────────────────────────────────────────────────

CREATE TYPE public.first_join_prompt_action AS ENUM (
  'shown',        -- the three cards rendered
  'card_tap',     -- "let's go" tapped (event_id = the tapped plan)
  'wishlist',     -- wishlist capture tapped
  'later',        -- skip link tapped
  'rebook_offer'  -- rebook-on-cancel sheet shown (spec a4, step 4)
);

-- ── first_join_prompts ───────────────────────────────────────────────────────

CREATE TABLE public.first_join_prompts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shown_event_ids  uuid[] NOT NULL DEFAULT '{}',
  action           public.first_join_prompt_action NOT NULL,
  -- The tapped plan on card_tap; NULL otherwise. No FK to events: analytics
  -- rows must survive plan deletion.
  event_id         uuid,
  -- Which fallback tier produced the card set ('base'|'wider_radius'|'no_vibe').
  tier             text,
  -- Per-weight instrumentation: [{event_id, score, breakdown:{neighborhood,
  -- likelihood, socialProof, bigRoom, vibe, weekend}}, ...] as computed by
  -- getFirstJoinCandidates at render time.
  score_breakdowns jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_first_join_prompts_user_created
  ON public.first_join_prompts (user_id, created_at DESC);
CREATE INDEX idx_first_join_prompts_action_created
  ON public.first_join_prompts (action, created_at DESC);

ALTER TABLE public.first_join_prompts ENABLE ROW LEVEL SECURITY;

-- Clients may only write their own rows; reads are service-role/analytics.
CREATE POLICY first_join_prompts_insert_own
  ON public.first_join_prompts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ── area_wishlists ───────────────────────────────────────────────────────────

CREATE TABLE public.area_wishlists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Snapshot at raise-hand time (client-provided from the profile), so the
  -- demand signal survives later profile edits.
  neighborhood  text,
  vibe_tags     text[],
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_area_wishlists_neighborhood
  ON public.area_wishlists (neighborhood) WHERE active;

ALTER TABLE public.area_wishlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY area_wishlists_insert_own
  ON public.area_wishlists FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY area_wishlists_update_own
  ON public.area_wishlists FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY area_wishlists_select_own
  ON public.area_wishlists FOR SELECT
  USING (auth.uid() = user_id);

-- updated_at maintenance: NEW trigger + function, never modifying existing
-- hooks (house rule).
CREATE FUNCTION public.touch_area_wishlists_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_area_wishlists
  BEFORE UPDATE ON public.area_wishlists
  FOR EACH ROW EXECUTE FUNCTION public.touch_area_wishlists_updated_at();

-- ── Self-test (in-transaction; rolls the whole migration back on failure) ────

DO $$
DECLARE
  v_user uuid;
  v_count int;
  v_first_created timestamptz;
BEGIN
  SELECT id INTO v_user FROM public.profiles LIMIT 1;
  IF v_user IS NULL THEN
    RAISE NOTICE 'first_join self-test: no profiles row, structural checks only';
    RETURN;
  END IF;

  -- first_join_prompts accepts every action value.
  INSERT INTO public.first_join_prompts (user_id, shown_event_ids, action, tier, score_breakdowns)
  VALUES
    (v_user, '{}', 'shown', 'base', '[{"event_id":"00000000-0000-0000-0000-000000000000","score":9,"breakdown":{"neighborhood":3,"likelihood":3,"socialProof":2,"bigRoom":0,"vibe":0,"weekend":1}}]'::jsonb),
    (v_user, '{}', 'card_tap', NULL, NULL),
    (v_user, '{}', 'wishlist', NULL, NULL),
    (v_user, '{}', 'later', NULL, NULL),
    (v_user, '{}', 'rebook_offer', NULL, NULL);
  SELECT count(*) INTO v_count FROM public.first_join_prompts WHERE user_id = v_user;
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'first_join self-test: expected 5 prompt rows, found %', v_count;
  END IF;

  -- area_wishlists upsert is idempotent on user_id: two taps, one row, and
  -- created_at survives the second tap.
  INSERT INTO public.area_wishlists (user_id, neighborhood, vibe_tags, active)
  VALUES (v_user, 'Echo Park', ARRAY['Music','Sports'], true);
  SELECT created_at INTO v_first_created FROM public.area_wishlists WHERE user_id = v_user;
  INSERT INTO public.area_wishlists (user_id, neighborhood, vibe_tags, active)
  VALUES (v_user, 'Silver Lake', ARRAY['Food'], true)
  ON CONFLICT (user_id) DO UPDATE
    SET neighborhood = EXCLUDED.neighborhood,
        vibe_tags = EXCLUDED.vibe_tags,
        active = EXCLUDED.active;
  SELECT count(*) INTO v_count FROM public.area_wishlists WHERE user_id = v_user;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'first_join self-test: expected 1 area_wishlists row, found %', v_count;
  END IF;
  IF (SELECT neighborhood FROM public.area_wishlists WHERE user_id = v_user) <> 'Silver Lake' THEN
    RAISE EXCEPTION 'first_join self-test: upsert did not update the snapshot';
  END IF;
  IF (SELECT created_at FROM public.area_wishlists WHERE user_id = v_user) <> v_first_created THEN
    RAISE EXCEPTION 'first_join self-test: upsert clobbered created_at';
  END IF;

  -- Leave no test data behind.
  DELETE FROM public.first_join_prompts WHERE user_id = v_user;
  DELETE FROM public.area_wishlists WHERE user_id = v_user;
END;
$$;

COMMIT;
