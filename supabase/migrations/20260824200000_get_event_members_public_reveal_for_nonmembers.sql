-- Root cause of the live "Who's Going" bug Liz flagged (WhatsApp, 2026-08-24):
-- "Also this might have been fixed but if it's easy and there's anyway to fix
-- The Who's going area before the build at all."
--
-- Confirmed live (pg_get_functiondef, 2026-08-24), not guessed: the plan detail
-- screen's member list (native app/plan/[id].tsx fetchMembers(), web
-- src/app/app/plan/[id]/page.tsx fetchData()) calls get_event_members_reveal(),
-- which is SECURITY DEFINER but has its own explicit membership gate:
--   IF NOT v_is_member THEN RAISE EXCEPTION 'User is not a member of this event';
-- For any viewer who has NOT joined the plan yet -- i.e. most viewers browsing a
-- plan they're deciding whether to join -- that RPC throws. Both clients then
-- fall back to a raw `.from('event_members').select(...)` table read, which
-- 20260813200000_event_members_anon_read_rls_fix.sql (applied and confirmed
-- live) now correctly restricts to `user_id = auth.uid() OR is_event_member()
-- OR is_event_organizer()` -- so the fallback returns zero rows too. End
-- result: members.length === 0, and the 2026-08-19 fix (commit fa74b2e)
-- papers over the blank state with a text count ("X people are going") instead
-- of real names/photos -- for every non-member viewer, on the single most-used
-- screen in the app. This is exactly the risk 20260813200000's own header
-- (lines 135-156) named and explicitly declined to guess at without a live
-- check: "If it turns out to ... have no membership check of its own, the
-- fallback path this migration would then start exercising on every
-- non-member plan-page view is the SAME class of bug ... just on a bigger
-- screen." Confirmed true.
--
-- Not a new product decision: the "Who's Going" section's own existence and
-- title on the plan detail page already establish that name+photo is meant to
-- be visible to any viewer deciding whether to join, not just members. This
-- restores that, it doesn't invent new exposure. Scope stays deliberately
-- narrow -- both call sites this fixes (native app/plan/[id].tsx,
-- web src/app/app/plan/[id]/page.tsx, confirmed via src/app/app/layout.tsx
-- lines 1/23/26 to sit behind a real `redirect("/auth/login")` auth gate, no
-- anon access) are the PLAN DETAIL screen only. The two denser "avatar-stack"
-- feed/featured-card sites (native app/(tabs)/plans/index.tsx:759-787, web
-- src/app/app/feed/page.tsx:537-548) are explicitly OUT of scope here --
-- 20260813200000 already deferred those to a human product/privacy call on
-- purpose, and that deferral still stands; this migration does not touch them.
--
-- Field selection is deliberately narrower than get_event_members_reveal
-- (which also returns bio/gender/vibe_tags/age/instagram/linkedin/tiktok for
-- confirmed members): id/user_id/role/status/joined_at/first_name_display/
-- profile_photo_url only. role+status are included (not just the 5 fields
-- native's Member interface reads) because washedup-web's MemberRow type
-- (src/app/app/plan/[id]/page.tsx line 66-84) requires both non-nullably and
-- renders `m.role === "host"` at line 1608 to show the organizer badge --
-- without it, a non-member viewer would silently lose the "who's the
-- organizer" signal that a member already sees today via the reveal RPC.
-- Neither is new PII: both are the same membership metadata already shown to
-- every confirmed member, not a new exposure class. Same blocked-relationship
-- filter as the existing reveal RPC (yours_is_blocked_between, confirmed live
-- SECURITY DEFINER) so a blocked user still never appears, member or not.
--
-- authenticated-only grant, anon explicitly revoked: both real call sites
-- require a signed-in session (see auth-gate citation above), and this
-- migration deliberately does not reopen the anon-avatar-exposure question
-- 20260813200000 closed for the two public share-link pages
-- (plans/[slug]/page.tsx, e/[id]/page.tsx), which still correctly get only an
-- integer count from get_event_joined_count/get_event_joined_counts, never
-- row-level member data.

BEGIN;

-- DROP first: the column list is changing (added role/status after this
-- migration's first same-day apply, see git history), and CREATE OR REPLACE
-- cannot change a function's RETURNS TABLE shape.
DROP FUNCTION IF EXISTS public.get_event_members_public(uuid);

CREATE FUNCTION public.get_event_members_public(p_event_id uuid)
 RETURNS TABLE(id uuid, user_id uuid, role text, status text, joined_at timestamptz, first_name_display text, profile_photo_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT em.id, em.user_id, em.role::text, em.status::text, em.joined_at, p.first_name_display, p.profile_photo_url
  FROM public.event_members em
  JOIN public.profiles p ON em.user_id = p.id
  WHERE em.event_id = p_event_id
    AND em.status = 'joined'
    AND NOT public.yours_is_blocked_between(auth.uid(), em.user_id)
  ORDER BY em.joined_at ASC;
$function$;

REVOKE ALL ON FUNCTION public.get_event_members_public(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_members_public(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-test. Grants first (cheap, always runs), then a real cross-role probe
-- simulating a genuine authenticated non-member -- the exact caller shape
-- that was silently returning zero rows before this migration -- using the
-- same set_config('request.jwt.claims', ...) + SET LOCAL ROLE technique
-- 20260813200000 already established, wrapped so an environment-level
-- restriction on SET ROLE only warns rather than blocking an otherwise-
-- correct migration.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event_id     uuid;
  v_member_uid   uuid;
  v_outsider_uid uuid;
  v_n            integer;
  v_name         text;
BEGIN
  IF has_function_privilege('anon', 'public.get_event_members_public(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-test failed: anon holds EXECUTE on get_event_members_public -- this must stay authenticated-only, the public share-link pages are supposed to keep getting only an integer count';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.get_event_members_public(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-test failed: authenticated lost EXECUTE on get_event_members_public -- breaks the plan-detail Who''s Going section for every non-member viewer, the exact bug this migration exists to fix';
  END IF;

  SELECT em.event_id, em.user_id INTO v_event_id, v_member_uid
  FROM public.event_members em
  WHERE em.status = 'joined'
  ORDER BY em.joined_at DESC NULLS LAST
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RAISE NOTICE 'no joined event_members row exists yet; skipping the live non-member probe (grant checks above already ran and passed)';
    RETURN;
  END IF;

  SELECT p.id INTO v_outsider_uid
  FROM public.profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.event_members em2
    WHERE em2.event_id = v_event_id AND em2.user_id = p.id
  )
  ORDER BY p.id
  LIMIT 1;

  IF v_outsider_uid IS NULL THEN
    RAISE NOTICE 'no profile outside event % available to test the non-member case; skipping', v_event_id;
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider_uid)::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*), max(first_name_display) INTO v_n, v_name
    FROM public.get_event_members_public(v_event_id);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF v_n = 0 THEN
      RAISE EXCEPTION 'get_event_members_public returned 0 rows for event % called as a genuine authenticated non-member -- the exact bug this migration exists to fix is still present', v_event_id;
    END IF;
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'get_event_members_public returned rows but no first_name_display for event % -- real member data is not coming through', v_event_id;
    END IF;
    RAISE NOTICE 'non-member probe passed: % row(s) visible, including real name data, for event % as an outsider', v_n, v_event_id;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', NULL, true);
      RAISE WARNING 'could not SET ROLE to authenticated in this environment to run the non-member probe -- UNVERIFIED here: %', SQLERRM;
    WHEN OTHERS THEN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', NULL, true);
      RAISE;
  END;
END $$;

COMMIT;
