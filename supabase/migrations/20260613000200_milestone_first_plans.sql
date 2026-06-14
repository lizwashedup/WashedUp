-- Migration 2 (2026-06-13): rename the >= 1 milestone tier "New crew" -> "First plans".
-- "crew" is a forbidden word in user-facing copy. Label is server-side only
-- (no client hardcode); yours_milestone() is the single source, read by
-- get_yours_grid / get_profile_card and rendered on PlanCard. All other tiers
-- are unchanged.

CREATE OR REPLACE FUNCTION public.yours_milestone(p_count integer)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_count >= 25 THEN 'Ride or die'
    WHEN p_count >= 10 THEN 'Down for anything'
    WHEN p_count >= 5  THEN 'Regular thing'
    WHEN p_count >= 3  THEN 'Getting somewhere'
    WHEN p_count >= 1  THEN 'First plans'
    ELSE NULL
  END;
$$;
