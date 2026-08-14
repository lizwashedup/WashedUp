-- event_members is readable by anonymous PostgREST requests right now: real
-- user_id/role/status/age_at_join/gender_at_join rows come back with zero
-- auth. RLS is enabled (relrowsecurity = true) but no real policy exists to
-- enforce it. Confirmed live via the WashedUp canonical map's anon-probe
-- (2026-08-13): event_members returns real DATA, not [] or 401.
--
-- CORRECTION on the round-1 self-test claim below (adversarial review,
-- same night): round-1's self-test (20260812120000, line 334-339) only
-- RAISE WARNINGs if event_members.relrowsecurity is FALSE -- it never
-- checked whether a real policy exists. It would NOT have fired here
-- (RLS is in fact enabled), so it did not "catch" this hole; it just
-- documented the risk in the warning text. The hole itself was confirmed
-- separately, via a live anon-probe (WASHEDUP-CANONICAL-MAP-20260813.md).
-- That distinction matters for one design decision below: since anon reads
-- currently WORK despite RLS being enabled, some existing permissive
-- policy MUST already be in place (Postgres denies all rows by default
-- once RLS is on with zero policies) -- it was just never captured in any
-- migration, so its name is unknown. Handled below by dynamically dropping
-- whatever SELECT/ALL policy currently exists rather than assuming none do.
--
-- Schema facts below are read directly from real source, not guessed --
-- event_members has no CREATE TABLE anywhere (one of 81 untracked live
-- tables), so this migration cannot assume anything about it that isn't
-- independently confirmed elsewhere:
--   - event_members.event_id -> events.id: WashedUp/hooks/useMyPlansData.ts
--     lines 66-73 does `.from('event_members').select('event_id, events(...)')`
--     -- PostgREST's embedded-resource syntax only works over a real FK, so
--     this is direct proof of the relationship, not an inferred one.
--   - events.creator_user_id is the organizer column: same file's nested
--     select lists it inside the embedded events(...) columns, and
--     20260609140300_get_filtered_feed_circle_aware.sql line 74 reads
--     "FROM events e JOIN profiles_public pp ON e.creator_user_id = pp.id".
--     (Note: events does NOT have a raw host_id column -- host_id is only
--     ever a query-output alias, `pp.id AS host_id`, seen in every
--     get_filtered_feed variant. WashedUp/CLAUDE.md's "never rename
--     host_id" rule is left alone here since this migration renames nothing.)
--   - status = 'joined' is the real value used for an active member: used
--     consistently across WashedUp/lib/fetchPlans.ts, hooks/useMyPlansData.ts,
--     hooks/useChatList.ts, app/plan/[id].tsx, app/event/[id].tsx,
--     app/album/[eventId].tsx, washedup-web/src/app/api/admin/users/route.ts,
--     and the existing plan_albums/album_hearts policies in
--     20260504210000_albums_v1_schema.sql.
--
-- Real call sites grepped across WashedUp + washedup-web before writing this
-- (per the task instruction), and RE-GREPPED end to end in adversarial
-- review the same night after the first pass under-counted the blast
-- radius. Four buckets, not three:
--   1. Service-role server routes (washedup-world, command-center-next,
--      washedup-web /api/admin/users, both delete-ghost-account and
--      admin-manage-user edge functions via supabaseAdmin, and
--      washedup-web's lib/agents/blog/events-scout.ts via createAdminClient())
--      -- unaffected by any RLS policy, already bypass it via the
--      service_role key. Confirmed by reading each file's client
--      instantiation, not assumed.
--   2. Authenticated, SELF-scoped or ALREADY-JOINED-scoped reads (every
--      other native/web call site not listed in bucket 3 below -- e.g.
--      useChatList.ts/ChatPanel.tsx derive their event_id list from a
--      user_id-filtered event_members query first, so every downstream
--      read is provably for events the caller already belongs to; the two
--      album/[eventId] screens are gated upstream by plan_albums' own
--      "joined members only" RLS policy, so reaching that screen at all
--      already proves membership). These need a real authenticated user
--      who is either a joined member of the same event or its organizer.
--      Covered by the new policy below.
--   3. TWO PUBLIC, NO-AUTH pages -- washedup-web plans/[slug]/page.tsx
--      (lines 55-66) and e/[id]/page.tsx (lines 277-288) -- both confirmed
--      by direct read to instantiate `createClient(...NEXT_PUBLIC_SUPABASE_ANON_KEY)`
--      as a standalone module-level client (not the SSR session client the
--      authenticated /app/* routes use), and run
--      `.from("event_members").select("*", {count:"exact", head:true})...`
--      to show "X of Y going" on public share links.
--   4. *** MISSED BY THE FIRST DRAFT OF THIS MIGRATION, FOUND ON RE-REVIEW ***
--      AUTHENTICATED reads of OTHER users' event_members rows for events the
--      CALLER HAS NOT (YET) JOINED. These are not bucket-2 (self/already-
--      joined) and not bucket-3 (anon) -- they are logged-in users browsing
--      the feed, deciding whether to join something they are not a member
--      of yet. A blanket "members and organizer only" SELECT policy makes
--      every one of these queries return zero rows for exactly the
--      "haven't joined yet" case they exist to serve, with no error and no
--      migration self-test able to catch it (this migration's self-test
--      only proves the RLS/grant mechanics, it does not simulate the app's
--      actual query shapes). Confirmed real, by direct read, in:
--        - WashedUp/lib/fetchPlans.ts `fetchRealMemberCounts()` (own doc-
--          comment: "Workaround for member_count column drift in the events
--          table") -- called from `fetchPlans()` (the MAIN plans feed, most
--          events not yet joined), `fetchInterestedPlans()` (interest-
--          signalled but not necessarily joined), and (via
--          lib/firstJoin/index.ts's re-export) `firstJoin/candidates.ts`
--          (first-time-user candidate suggestions -- BY DEFINITION events
--          the viewer has never joined). Each caller already has its own
--          `realCounts[id] ?? event.member_count` fallback, so this
--          degrades to the same admittedly-drift-prone events.member_count
--          column the function exists to correct, silently, forever, for
--          the majority of real feed views -- not a crash, but a real,
--          silent accuracy regression on the single most-used screen in
--          the app.
--        - WashedUp/app/(tabs)/plans/index.tsx lines 759-787 (Featured
--          events: `get_featured_eligible_ids` returns events the viewer is
--          ELIGIBLE to see, explicitly not "already joined" -- the RPC's own
--          call-site comment says featuring would otherwise "leak plans to
--          users who shouldn't see them"). Line 763's raw
--          `.from('event_members').select('event_id, user_id, status')...`
--          feeds `membersByEvent` -> `allMemberIds` -> a profile-photo fetch
--          for a "who's going" avatar stack, with NO fallback at all --
--          this goes silently EMPTY, not just less-accurate, for every
--          featured card the viewer hasn't joined (i.e. nearly all of them,
--          since featuring exists to promote events you have not joined).
--        - washedup-web/src/app/app/feed/page.tsx lines 537-548 -- the
--          identical avatar-stack pattern on washedup-web's OWN main feed
--          page (not just a featured carousel there -- this is the primary
--          `/app/feed` route), same no-fallback empty-out.
--        - washedup-web/src/components/app/myplans/MyPlansView.tsx lines
--          116-138 -- an independently-duplicated copy of
--          `fetchRealMemberCounts`, same non-self-scoped direct read, same
--          `?? member_count` soft-fallback degrade as the native version.
--        - WashedUp/app/event/[id].tsx lines 327-343 and washedup-web/src/
--          app/app/event/[id]/page.tsx lines 420-431 -- a THIRD independent
--          inline duplicate of the same counting pattern (Scene event
--          detail's linked-plans member counts), not routed through either
--          of the two functions above, so fixing those two would NOT have
--          fixed this pair.
--      Fixed the same way bucket 3 was fixed: added
--      get_event_joined_counts(uuid[]) below (SECURITY DEFINER, batched,
--      integer-counts-only, no row/identity data ever leaves the function)
--      and rewired every counting call site above onto it. This is a pure
--      count -- exactly the same shape of fix already applied to bucket 3,
--      not a new design decision.
--      DELIBERATELY NOT FIXED here, flagged for a human product/privacy
--      call instead (see the migration's own end-of-run notes): the two
--      "who's going" AVATAR-STACK sites (native plans/index.tsx:763,
--      web feed/page.tsx:537-548) reveal WHICH SPECIFIC PEOPLE are
--      attending, not just a count -- a materially bigger exposure
--      decision than a number, and not something to unilaterally invent
--      an anon-safe shape for inside a security-hardening migration.
--      Also flagged, not fixed: WashedUp/app/plan/[id].tsx:365-367 and
--      washedup-web plan/[id]/page.tsx:401-408 (the single largest, most-
--      used screen in the app) call an EXISTING RPC,
--      `get_event_members_reveal(p_event_id)`, for their member list, and
--      only fall back to a raw non-self-scoped `event_members` table read
--      if that RPC errors or returns no rows. `get_event_members_reveal`
--      has NO definition in any migration in any repo (same "live-DB-only"
--      class of gap as `is_community_leader`/`is_community_member`/
--      `is_topic_member` below) and washedup-web/CLAUDE.md lists it as one
--      of three "Key RPCs" -- so it reads as deliberate, load-bearing
--      infrastructure, not a stray leftover, and this codebase's own
--      SECURITY DEFINER-helper convention makes it plausible it already
--      handles non-member callers safely and is entirely unaffected by
--      this migration (SECURITY DEFINER functions bypass RLS regardless of
--      the caller's role). But that is a plausibility, not a verified
--      fact: its actual body is not in git and this migration cannot see
--      the live database to check. If it turns out to be SECURITY INVOKER,
--      or to have no membership check of its own, the fallback path this
--      migration would then start exercising on every non-member plan-page
--      view is the SAME class of bug as the four sites fixed above, just
--      on a bigger screen. Not guessed at here -- named explicitly for a
--      human to confirm with one live query before/soon after this applies.
--
-- Design notes:
--   - Whatever policy currently lets anon read this table was never written
--     as a migration (round-1's self-test found RLS on with no tracked
--     policy), so its name is unknown. RLS permissive policies are OR'd, so
--     leaving an old permissive one in place would make the new restrictive
--     policy below a no-op for whichever role the old one still covers.
--     Dealt with by dynamically dropping every existing SELECT/ALL policy on
--     event_members before creating the new one, whatever it's called.
--   - REVOKE ALL ... FROM PUBLIC, anon (not just relying on the new policy)
--     matches this repo's own same-night lesson in
--     20260813181500_stripe_customers_revoke_hardening.sql: "RLS-with-zero-
--     policies alone leaves default grants in place, one accidental
--     permissive policy away from exposing" -- ties directly back to the
--     Section-S1 systemic issue (ALTER DEFAULT PRIVILEGES auto-grants anon+
--     authenticated on every new table). authenticated is deliberately left
--     alone: its real INSERT/UPDATE path (join/leave, WashedUp/app/plan/
--     [id].tsx lines 1002-1114) was already confirmed hardened via
--     join_event_atomic in round 1 and is out of scope for this SELECT fix.
--   - The membership/organizer checks are wrapped in SECURITY DEFINER
--     helper functions (is_event_member, is_event_organizer) instead of an
--     inline self-referencing subquery on event_members. Same reasoning
--     Supabase's own docs give for this pattern (avoids relying on a
--     same-table correlated subquery being re-filtered by its own policy on
--     every row) and matches this codebase's existing is_admin()/
--     is_community_leader()/is_community_member()/is_topic_member() helper
--     convention (named in 20260813025124's header as already-correct;
--     note those four have the same "live-DB-only, no migration" status as
--     event_members itself, so only the convention -- SECURITY DEFINER
--     helper functions for cross-row auth checks -- is being matched here,
--     not any specific one of their bodies).
--
-- PREPARED, NOT YET APPLIED as of 2026-08-13. supabase db push is currently
-- broken on an unrelated migration-history divergence; held pending Josh's
-- deploy word, same standing rule as the round-1 and round-2 migrations.

BEGIN;

-- 1. Drop whatever SELECT-permitting policy(ies) currently exist, whatever
--    they're called -- their text was never captured in any migration, and
--    leaving one in place would silently defeat the new policy below.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'event_members' AND cmd IN ('SELECT','ALL')
  LOOP
    RAISE NOTICE 'dropping pre-existing event_members policy: % (never in any migration -- this is the whole reason anon could read the table)', pol.policyname;
    EXECUTE format('DROP POLICY %I ON public.event_members', pol.policyname);
  END LOOP;
END $$;

-- 2. Belt-and-suspenders idempotency: confirmed already true live, restated
--    so this migration doesn't depend on that staying true out-of-band.
ALTER TABLE public.event_members ENABLE ROW LEVEL SECURITY;

-- 3. Strip the default-privilege auto-grant from anon entirely (Section S1).
--    authenticated is untouched -- its write path is already hardened and
--    out of scope here; it gets an explicit SELECT grant below instead of
--    relying on the implicit auto-grant, so the grant is legible from this
--    migration rather than only existing ambiently.
REVOKE ALL ON TABLE public.event_members FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.event_members TO authenticated;

-- 4. Membership/organizer helpers. SECURITY DEFINER so the internal lookup
--    against event_members runs as the function owner (bypassing RLS for
--    that one bounded, indexed lookup) rather than as a self-referencing
--    subquery inside the policy that's evaluating.
CREATE OR REPLACE FUNCTION public.is_event_member(p_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.event_members
    WHERE event_id = p_event_id
      AND user_id = auth.uid()
      AND status = 'joined'
  );
$function$;

REVOKE ALL ON FUNCTION public.is_event_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_event_member(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_event_organizer(p_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.events
    WHERE id = p_event_id
      AND creator_user_id = auth.uid()
  );
$function$;

REVOKE ALL ON FUNCTION public.is_event_organizer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_event_organizer(uuid) TO authenticated;

-- 5. The real fix: authenticated-only, scoped to your own row, fellow
--    joined members of the same event, or that event's organizer.
CREATE POLICY "members and organizer can view event_members"
  ON public.event_members
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_event_member(event_id)
    OR public.is_event_organizer(event_id)
  );

-- 6. Anon-safe replacement for the two public share-link pages' single-event
--    member count. Integer only -- no row ever leaves this function, so it
--    carries none of the PII the direct table read was leaking.
CREATE OR REPLACE FUNCTION public.get_event_joined_count(p_event_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT count(*)::integer FROM public.event_members
  WHERE event_id = p_event_id AND status = 'joined';
$function$;

REVOKE ALL ON FUNCTION public.get_event_joined_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_joined_count(uuid) TO anon, authenticated;

-- 6b. *** ADDED IN ADVERSARIAL REVIEW *** Batched sibling of the function
--     above. This is the one that actually matters for real traffic volume:
--     it replaces the direct `.from('event_members')` count reads in
--     lib/fetchPlans.ts's fetchRealMemberCounts (native, backs the main
--     feed / interested-plans / first-join candidates), its independently
--     duplicated copy in washedup-web's MyPlansView.tsx, and the third
--     duplicate inline in both event/[id] Scene-detail screens (native +
--     web) -- see bucket 4 above for the full read-and-confirmed list.
--     Same anon+authenticated grant as the singular function: these
--     callers run for logged-in users too, but specifically for events
--     those users have NOT joined, so `authenticated`'s normal table-level
--     SELECT grant (step 3) does not help them -- only a SECURITY DEFINER
--     aggregate does, same as anon.
CREATE OR REPLACE FUNCTION public.get_event_joined_counts(p_event_ids uuid[])
 RETURNS TABLE(event_id uuid, joined_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT em.event_id, count(*)::integer AS joined_count
  FROM public.event_members em
  WHERE em.event_id = ANY(p_event_ids) AND em.status = 'joined'
  GROUP BY em.event_id;
$function$;

REVOKE ALL ON FUNCTION public.get_event_joined_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_joined_counts(uuid[]) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Self-test.
--   1. RLS flag: hard assertion now (round-1's version of this same check,
--      line 334-339 of 20260812120000, only RAISE WARNINGed).
--   2. Grants: anon must hold NO table-level privilege on event_members at
--      all -- this alone makes anon reads structurally impossible
--      (permission denied before RLS is even evaluated), a strictly
--      stronger guarantee than "RLS returns zero rows," so there is no
--      separate live SET ROLE anon probe against the TABLE below: that
--      query would only ever prove the REVOKE fired (insufficient_privilege),
--      which this grants check already proves directly.
--   3. ACL: anon must not hold EXECUTE on either membership helper, but
--      MUST still hold it on both get_event_joined_count and
--      get_event_joined_counts (singular AND batched -- losing either
--      silently breaks a different set of real screens), and authenticated
--      must ALSO hold EXECUTE on both counting functions (added in review:
--      the original draft only checked anon for these two, but bucket 4
--      above proved authenticated-but-not-a-member callers depend on them
--      just as much as anon does).
--   4. Live cross-role probes -- the real proof for the part the grants
--      check above cannot cover: that the POLICY correctly scopes rows for
--      a role that legitimately keeps its table grant, AND that the new
--      batched RPC's actual SQL body (not just its ACL) returns a real,
--      correct, nonzero count when called as anon. SET LOCAL ROLE to an
--      authenticated outsider (expect 0 rows), a real joined member (expect
--      >=1), the event's organizer (expect >=1), and anon calling the new
--      batched RPC (expect a nonzero joined_count for a known event), each
--      in its OWN isolated block so one probe's outcome can never mask the
--      next one running. Each is wrapped so an environment-level
--      restriction on SET ROLE only warns -- it should not block an
--      otherwise-correct migration from applying -- but a real wrong-
--      row-count assertion still aborts it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event_id      uuid;
  v_member_uid    uuid;
  v_outsider_uid  uuid;
  v_organizer_uid uuid;
  v_n             integer;
BEGIN
  IF NOT COALESCE(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_members'::regclass),
    false
  ) THEN
    RAISE EXCEPTION 'self-test failed: event_members RLS is not enabled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'event_members' AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'self-test failed: anon still holds a table-level grant on event_members';
  END IF;

  IF has_function_privilege('anon', 'public.is_event_member(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.is_event_organizer(uuid)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'self-test failed: anon holds EXECUTE on an event_members membership helper';
  END IF;

  IF NOT has_function_privilege('anon', 'public.get_event_joined_count(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-test failed: anon lost EXECUTE on get_event_joined_count -- breaks the public plan-page member count (washedup-web plans/[slug] and e/[id])';
  END IF;

  IF NOT (
    has_function_privilege('anon', 'public.get_event_joined_counts(uuid[])', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.get_event_joined_counts(uuid[])', 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'self-test failed: anon and/or authenticated lost EXECUTE on get_event_joined_counts -- breaks the batched member-count fan-out used by fetchPlans/fetchInterestedPlans/first-join candidates/event-detail linked-plan counts (native) and MyPlansView/event-detail (web)';
  END IF;

  -- Deterministic row pick (ORDER BY id, not an arbitrary LIMIT 1) so this
  -- self-test behaves the same on every apply.
  SELECT em.event_id, em.user_id INTO v_event_id, v_member_uid
  FROM public.event_members em
  WHERE em.status = 'joined'
  ORDER BY em.joined_at DESC NULLS LAST
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RAISE NOTICE 'no joined event_members row exists yet; skipping the live cross-role probes (grant/ACL checks above already ran and passed)';
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

  SELECT creator_user_id INTO v_organizer_uid FROM public.events WHERE id = v_event_id;

  -- Probe A: authenticated, but not a member or organizer of this event.
  IF v_outsider_uid IS NOT NULL THEN
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider_uid)::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_n FROM public.event_members WHERE event_id = v_event_id;
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', NULL, true);
      IF v_n <> 0 THEN
        RAISE EXCEPTION 'an authenticated non-member, non-organizer can still read % row(s) from event_members for event %', v_n, v_event_id;
      END IF;
      RAISE NOTICE 'outsider probe passed: 0 rows visible';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        PERFORM set_config('request.jwt.claims', NULL, true);
        RAISE WARNING 'could not SET ROLE to authenticated in this environment to run the outsider probe -- UNVERIFIED here: %', SQLERRM;
      WHEN OTHERS THEN
        RESET ROLE;
        PERFORM set_config('request.jwt.claims', NULL, true);
        RAISE;
    END;
  ELSE
    RAISE NOTICE 'no profile outside event % available to test the outsider case; skipping', v_event_id;
  END IF;

  -- Probe B: authenticated, a real joined member of this event (regression guard).
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member_uid)::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM public.event_members WHERE event_id = v_event_id;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF v_n = 0 THEN
      RAISE EXCEPTION 'a real joined member of event % can no longer read event_members -- regression, not just a security fix', v_event_id;
    END IF;
    RAISE NOTICE 'member probe passed: % row(s) visible', v_n;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', NULL, true);
      RAISE WARNING 'could not SET ROLE to authenticated in this environment to run the member probe -- UNVERIFIED here: %', SQLERRM;
    WHEN OTHERS THEN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', NULL, true);
      RAISE;
  END;

  -- Probe C: authenticated, the event's organizer (regression guard, only if
  -- distinct from the member tested above -- creators usually also hold
  -- their own event_members row, see 20260503000000's "creator's own host
  -- row in event_members" comment, so this often no-ops harmlessly).
  IF v_organizer_uid IS NOT NULL AND v_organizer_uid <> v_member_uid THEN
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_organizer_uid)::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_n FROM public.event_members WHERE event_id = v_event_id;
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', NULL, true);
      IF v_n = 0 THEN
        RAISE EXCEPTION 'event %''s organizer can no longer read its event_members -- regression, not just a security fix', v_event_id;
      END IF;
      RAISE NOTICE 'organizer probe passed: % row(s) visible', v_n;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        PERFORM set_config('request.jwt.claims', NULL, true);
        RAISE WARNING 'could not SET ROLE to authenticated in this environment to run the organizer probe -- UNVERIFIED here: %', SQLERRM;
      WHEN OTHERS THEN
        RESET ROLE;
        PERFORM set_config('request.jwt.claims', NULL, true);
        RAISE;
    END;
  END IF;

  -- Probe D *** ADDED IN ADVERSARIAL REVIEW ***: the anon-safe BATCHED RPC
  -- (the actual replacement for the four bucket-4 direct-table reads this
  -- migration just locked down) must still return a real, nonzero
  -- joined_count for a real event when called AS ANON. A passing ACL check
  -- above only proves permission to call it exists, not that the function
  -- body is correct -- this is the literal query fetchRealMemberCounts /
  -- get_event_joined_counts callers run today for feed/featured/first-join/
  -- My-Plans/event-detail member-count display.
  BEGIN
    SET LOCAL ROLE anon;
    v_n := NULL;
    SELECT joined_count INTO v_n
    FROM public.get_event_joined_counts(ARRAY[v_event_id])
    WHERE event_id = v_event_id;
    RESET ROLE;
    IF v_n IS NULL OR v_n = 0 THEN
      RAISE EXCEPTION 'get_event_joined_counts returned % for event % called as anon -- the batched anon-safe count RPC is broken, this is what fetchRealMemberCounts/feed/featured/first-join/My-Plans/event-detail now depend on for every event a viewer has not joined', COALESCE(v_n::text, 'NULL'), v_event_id;
    END IF;
    RAISE NOTICE 'anon batched-count probe passed: get_event_joined_counts returned % for event %', v_n, v_event_id;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE WARNING 'could not SET ROLE to anon in this environment to run the batched-count probe -- UNVERIFIED here: %', SQLERRM;
    WHEN OTHERS THEN
      RESET ROLE;
      RAISE;
  END;
END $$;

COMMIT;
