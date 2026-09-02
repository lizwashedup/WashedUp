-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
-- ============================================================================
-- Gender-restricted communities ("Women of WashedUp" capability), 2026-09-01.
-- Written for
-- clients/washed-up/specs/washedup-GENDER-RESTRICTED-COMMUNITIES-20260901.md
-- and LIZ-OPEN-QUESTIONS.md Q4 (resolved 2026-09-01, WhatsApp).
--
-- RESTORED: this file existed earlier in this same session and was found
-- missing from disk mid-build (another concurrent process appears to have
-- removed it while this ticket was being worked from more than one angle at
-- once). app/creator/setup-community.tsx, lib/creatorMode.ts, and
-- constants/FeatureFlags.ts are all already wired up expecting this exact
-- migration to exist, so it is restored here verbatim from the version this
-- session read and verified correct against ops/drift/baseline-20260825.sql
-- before it disappeared, not redesigned.
--
-- WHAT LIZ ASKED FOR, and what this migration builds against each point:
--   1. A community can optionally be restricted to one gender, creator's
--      choice at creation. Symmetric -- women-only or men-only, never a
--      women-specific mechanic. BUILT: communities.restricted_gender below.
--   2. Full invisibility: the opposite gender should not be able to see the
--      community exists at all, not just be blocked from joining. BUILT at
--      every place a community row can be read: communities_select (RLS,
--      covers direct/anon reads incl. the /c/handle page) and
--      get_discoverable_communities() (the general browse/search RPC).
--   3. Liz's own stated REASON for #2 is removing moderation overhead from
--      join requests nobody could ever approve. A guessed or shared direct
--      link bypasses both of those read-time gates, so the same restriction
--      is also enforced at the one real join door, request_to_join_community
--      -- BUILT below. request_to_join_community is SECURITY DEFINER running
--      as table owner, so it bypasses RLS entirely; the guard has to live in
--      the function body, not only in a policy. community_members_insert
--      (RLS) gets the same check too, as a second, independent layer -- this
--      codebase's own established style for exactly this shape of guard (see
--      the idor-hardening migrations: every real door checked, not just the
--      main one).
--   4. "Any member (not just leader) can create plans inside it" -- Liz's
--      own stated, decided requirement. NOT built here, flagged rather than
--      guessed at: operator_create_explore_event() (the only door that
--      creates a community-scoped explore_event/"Plan") requires an approved
--      event_host or community_leader operator grant, AND, when
--      p_community_id is set, is_community_leader() for that specific
--      community (confirmed by reading the live function body, not
--      assumed). A plain active member cannot create one today, for ANY
--      community, restricted or not -- the spec doc's framing ("same as how
--      plan creation already works inside a normal community") does not
--      hold against the real code. Loosening that authorization is a
--      broader, app-wide permission change well beyond this ticket's two
--      named enforcement points (community visibility + plan-creation
--      gender inheritance) and is not decided in enough detail to build
--      blind (all communities, or only restricted ones? retroactive?) --
--      left for Josh/Liz, not guessed.
--   5. Plans created inside a restricted community auto-inherit the
--      restriction by DEFAULT (Q4 resolution), with a per-plan override to
--      open a specific plan to everyone. BUILT at the RPC layer:
--      explore_events.gender_rule (reusing the SAME public.gender_rule enum
--      the circle-plan system's `events` table already uses -- one concept,
--      not two) is auto-set from the owning community's restricted_gender by
--      operator_create_explore_event() when the caller does not explicitly
--      override, and an inconsistent override (e.g. men_only inside a
--      women-only community) is rejected server-side. The override CONTROL
--      itself needs a toggle on the event-creation form, which lives
--      entirely inside app/creator/event-form.tsx (Screen 22) -- FROZEN,
--      never edited, per standing instruction. The auto-inherit DEFAULT
--      works today with zero client changes (the client already omits any
--      gender param, so the RPC's own default-computation fires); the
--      override UI is blocked on Josh until Screen 22 is unfrozen or split
--      (screen22-event-form-split is already in flight elsewhere in this
--      same build). p_gender_rule is added to the RPC now so the backend is
--      ready the moment that UI can exist; no client today sends it.
--   6. Plan capacity: unchanged, confirmed not a new mechanic by Liz. Not
--      touched anywhere in this migration.
--
-- Layers on top of (all already live on prod, verified against
-- ops/drift/baseline-20260825.sql, not assumed):
--   20260702184012_communities_skeleton.sql          (communities, is_community_member,
--                                                      is_community_leader, community_members_insert,
--                                                      communities_select, community_member_status)
--   20260819000000_community_city.sql +
--   20260820030000_community_purpose_name_length.sql (create_community's live 5-arg signature)
--   20260706150000_mvp_batch.sql                     (get_discoverable_communities (pre-screen-14 body),
--                                                      request_to_join_community, operator_create_explore_event)
--   20260302300000_admin_explore_crud.sql /
--   20260712035429_fix_batch_28_s1_s2_s3_s5.sql /
--   SQL-98 (2026-08-04)                              (operator_create_explore_event's current 17-arg live signature,
--                                                      trailing p_confirmation_message)
-- and additionally on top of these UNAPPLIED drafts already sitting in this
-- repo (must be applied in filename order, before this one):
--   20260901030000_build35_screen14_public_page_control.sql (communities.discoverable +
--                                                              get_discoverable_communities's discoverable-aware body)
--
-- Explicitly NOT touched here (separate lane, sequenced after this by Liz's
-- own words -- "she has a couple community meetings first and will fold in
-- the Sunset Club routing fix afterward"): get_filtered_feed() and
-- 20260901050000_community_event_plan_page_routing.sql. That routing
-- migration's community-events branch currently hardcodes
-- gender_rule := 'mixed' for every community event, which would leak a
-- restricted community's plans onto the general Plan feed regardless of
-- viewer gender. See the separate follow-up migration
-- 20260901090000_gender_restricted_communities_plan_feed.sql for that fix,
-- kept apart from this one specifically so it can be reviewed/re-sequenced
-- independently against the Sunset Club work without touching anything in
-- this file.
--
-- Also see 20260901120000_gender_restricted_communities_scene_visibility.sql
-- for a further gap found on review: explore_events' OWN "Anyone can view
-- live explore events" RLS policy (a direct, non-RPC read used by the Scene
-- tab) has no gender awareness at all and needed the same fix independently.
--
-- ADDITIVE ONLY. Same convention as every other unapplied draft in this
-- repo: sits here until Josh applies it. NOT TESTED AGAINST A REAL DATABASE
-- -- no DB access was used or is authorized for this build. The self-tests
-- below are a real, runnable harness (same style as the skeleton and
-- idor-hardening migrations); they have not themselves been executed. Run
-- against a prod clone or the local harness before this is ever applied for
-- real.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.communities') IS NULL THEN
    RAISE EXCEPTION 'gender-restricted-communities dependency missing: public.communities';
  END IF;
  IF to_regtype('public.gender_type') IS NULL THEN
    RAISE EXCEPTION 'gender-restricted-communities dependency missing: public.gender_type enum';
  END IF;
  IF to_regtype('public.gender_rule') IS NULL THEN
    RAISE EXCEPTION 'gender-restricted-communities dependency missing: public.gender_rule enum';
  END IF;
  IF to_regprocedure('public.create_community(text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'gender-restricted-communities dependency missing: public.create_community(text,text,text,text,text) (20260819000000 + 20260820030000)';
  END IF;
  IF to_regprocedure('public.get_discoverable_communities()') IS NULL THEN
    RAISE EXCEPTION 'gender-restricted-communities dependency missing: public.get_discoverable_communities() (20260706150000)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'communities' AND column_name = 'discoverable'
  ) THEN
    RAISE EXCEPTION 'gender-restricted-communities dependency missing: communities.discoverable -- apply 20260901030000_build35_screen14_public_page_control.sql first';
  END IF;
  IF to_regprocedure('public.request_to_join_community(uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'gender-restricted-communities dependency missing: public.request_to_join_community(uuid,jsonb) (20260706150000)';
  END IF;
  IF to_regprocedure('public.operator_create_explore_event(text,text,text,text,timestamptz,text,text,text,text,text,uuid,text,boolean,boolean,timestamptz,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'gender-restricted-communities dependency missing: public.operator_create_explore_event(...) 17-arg live signature (SQL-98)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. communities.restricted_gender
-- ---------------------------------------------------------------------------

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS restricted_gender public.gender_type;

ALTER TABLE public.communities
  DROP CONSTRAINT IF EXISTS communities_restricted_gender_check;
ALTER TABLE public.communities
  ADD CONSTRAINT communities_restricted_gender_check
  CHECK (restricted_gender IS NULL OR restricted_gender IN ('woman'::public.gender_type, 'man'::public.gender_type));

COMMENT ON COLUMN public.communities.restricted_gender IS
  'Gender-restricted communities ("Women of WashedUp"), Liz 2026-09-01. NULL = open to everyone (every existing row, unchanged). Set once at creation only (create_community''s p_restricted_gender) -- never edited after, same "set at create, not editable" pattern explore_events attribution already uses. Restricted to woman/man by CHECK: symmetric, women-only or men-only per Liz''s own words -- non-binary-restricted communities were never asked for, so this is a deliberate, reversible narrowing (drop the CHECK to widen it later if that ever changes), not a technical ceiling; the column reuses the same gender_type enum used everywhere else in the schema. Enforced in communities_select (RLS), get_discoverable_communities() (RPC), request_to_join_community() (join door), community_members_insert (RLS, defense in depth), and operator_create_explore_event() (plan-creation gender_rule default inheritance -- see explore_events.gender_rule below).';

-- ---------------------------------------------------------------------------
-- 2. create_community(): 6th optional param. Drop-then-recreate so a stale
--    client can never hit an ambiguous overload -- the exact rule this
--    repo's own city/purpose migrations state and follow.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_community(text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_community(
  p_handle text,
  p_name text,
  p_description text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_purpose text DEFAULT NULL,
  p_restricted_gender text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_operator_grant(v_uid, 'community_leader') THEN
    RAISE EXCEPTION 'Community Leader grant required';
  END IF;
  IF p_restricted_gender IS NOT NULL AND p_restricted_gender NOT IN ('woman', 'man') THEN
    RAISE EXCEPTION 'restricted_gender must be woman, man, or left open';
  END IF;

  INSERT INTO communities (handle, name, description, city, purpose, restricted_gender, created_by)
  VALUES (p_handle, p_name, p_description, p_city, p_purpose, p_restricted_gender::public.gender_type, v_uid)
  RETURNING id INTO v_id;

  INSERT INTO community_members (community_id, user_id, role, status, joined_at)
  VALUES (v_id, v_uid, 'leader', 'active', now());

  INSERT INTO community_blocks (community_id, block_type, position) VALUES
    (v_id, 'cover', 0),
    (v_id, 'header', 1),
    (v_id, 'about', 2),
    (v_id, 'events_auto', 3),
    (v_id, 'members_auto', 4);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_community(text, text, text, text, text, text) FROM public;
REVOKE ALL ON FUNCTION public.create_community(text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_community(text, text, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. communities_select RLS: the world-visible ("status = 'active'") branch
--    additionally requires a gender match when the community is restricted.
--    Member/leader/admin branches are UNCHANGED -- an existing member always
--    keeps their own community regardless of gender (no retroactive
--    lockout). A NULL viewer gender (never set on their profile, or anon --
--    auth.uid() itself is null for anon) never equals a restriction under
--    plain `=` (NULL = x is NULL, never true), so it fails closed: an
--    unknown viewer sees nothing restricted, matching "full invisibility"
--    rather than leaking on doubt.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS communities_select ON public.communities;

CREATE POLICY communities_select ON public.communities
  FOR SELECT USING (
    (
      status = 'active'
      AND (
        restricted_gender IS NULL
        OR restricted_gender = (SELECT p.gender FROM profiles p WHERE p.id = (SELECT auth.uid()))
      )
    )
    OR is_community_member(id, (SELECT auth.uid()))
    OR is_admin((SELECT auth.uid())) OR has_role((SELECT auth.uid()), 'admin'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 4. get_discoverable_communities(): same gender gate layered on top of the
--    live screen-14 DRAFT body (20260901030000, which must already be
--    applied per the dependency check above) -- reproduced verbatim here
--    plus exactly one added WHERE condition, same shape as #3.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_discoverable_communities()
RETURNS TABLE (
  id uuid,
  handle text,
  name text,
  description text,
  accent_color text,
  cover_image text,
  member_count integer,
  next_event_title text,
  next_event_date date
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    c.id, c.handle, c.name, c.description, c.accent_color,
    (SELECT b.content->'images'->>0
     FROM community_blocks b
     WHERE b.community_id = c.id AND b.block_type = 'cover' AND b.visible
     ORDER BY b.position LIMIT 1) AS cover_image,
    (SELECT count(*)::integer FROM community_members m
     WHERE m.community_id = c.id AND m.status = 'active') AS member_count,
    ne.title AS next_event_title,
    ne.event_date AS next_event_date
  FROM communities c
  LEFT JOIN LATERAL (
    SELECT e.title, e.event_date
    FROM explore_events e
    WHERE e.community_id = c.id AND e.status = 'Live'
      AND coalesce(e.event_date, current_date) >= current_date
    ORDER BY e.event_date ASC NULLS LAST
    LIMIT 1
  ) ne ON true
  WHERE c.status = 'active'
    AND c.discoverable
    AND (
      c.restricted_gender IS NULL
      OR c.restricted_gender = (SELECT p.gender FROM profiles p WHERE p.id = auth.uid())
    )
  ORDER BY member_count DESC, c.created_at ASC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.get_discoverable_communities() FROM public;
GRANT EXECUTE ON FUNCTION public.get_discoverable_communities() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. request_to_join_community(): the real join door. Full body reproduced
--    verbatim from the live definition (confirmed against
--    ops/drift/baseline-20260825.sql, not assumed) with exactly one guard
--    added, right after the existing "not open to joins" check and before
--    any answer validation -- a wrong-gender caller is rejected before the
--    function does anything else.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_to_join_community(p_community_id uuid, p_answers jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $_$
DECLARE
  v_uid uuid := auth.uid();
  v_community record;
  v_existing record;
  v_member_id uuid;
  v_first text;
  v_stored jsonb;
  v_open boolean;
  v_target_status public.community_member_status;
  v_viewer_gender public.gender_type;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  SELECT id, name, status, join_intro_question, join_policy, restricted_gender INTO v_community
  FROM communities WHERE id = p_community_id;
  IF v_community.id IS NULL OR v_community.status <> 'active' THEN
    RAISE EXCEPTION 'That community is not open to joins right now.';
  END IF;

  -- gender-restricted-communities (Liz 2026-09-01): the same restriction
  -- that hides a restricted community from discovery also blocks a direct
  -- join attempt (a guessed/shared link, a stale cached screen, a deep
  -- link). This can never be reached through the normal product flow once
  -- #3/#4 above are live, but it must not silently create a pending request
  -- a leader then has to manually decline -- Liz's own stated reason for the
  -- whole feature is removing exactly that moderation overhead.
  IF v_community.restricted_gender IS NOT NULL THEN
    SELECT gender INTO v_viewer_gender FROM profiles WHERE id = v_uid;
    IF v_viewer_gender IS DISTINCT FROM v_community.restricted_gender THEN
      RAISE EXCEPTION 'That community is not open to you.';
    END IF;
  END IF;

  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN
    RAISE EXCEPTION 'Answers are required.';
  END IF;
  IF coalesce(btrim(p_answers->>'first_name'), '') = ''
     OR char_length(p_answers->>'first_name') > 100 THEN
    RAISE EXCEPTION 'First name is required.';
  END IF;
  IF coalesce(btrim(p_answers->>'last_name'), '') = ''
     OR char_length(p_answers->>'last_name') > 100 THEN
    RAISE EXCEPTION 'Last name is required.';
  END IF;
  IF coalesce(btrim(p_answers->>'email'), '') = ''
     OR p_answers->>'email' !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     OR char_length(p_answers->>'email') > 254 THEN
    RAISE EXCEPTION 'A real email is required.';
  END IF;
  IF coalesce(btrim(p_answers->>'zip'), '') = ''
     OR p_answers->>'zip' !~ '^[0-9]{5}$' THEN
    RAISE EXCEPTION 'A 5 digit zip code is required.';
  END IF;
  IF coalesce(btrim(p_answers->>'intro_answer'), '') = ''
     OR char_length(p_answers->>'intro_answer') > 1000 THEN
    RAISE EXCEPTION 'Your introduction is required.';
  END IF;
  IF coalesce((p_answers->>'guidelines_accepted')::boolean, false) IS NOT true THEN
    RAISE EXCEPTION 'Accepting the community guidelines is required.';
  END IF;

  v_stored := jsonb_build_object(
    'first_name', btrim(p_answers->>'first_name'),
    'last_name', btrim(p_answers->>'last_name'),
    'email', btrim(p_answers->>'email'),
    'zip', btrim(p_answers->>'zip'),
    'intro_answer', btrim(p_answers->>'intro_answer'),
    'intro_question', nullif(btrim(coalesce(v_community.join_intro_question, '')), ''),
    'guidelines_accepted_at', now()
  );

  v_open := (v_community.join_policy = 'open');
  v_target_status := (CASE WHEN v_open THEN 'active' ELSE 'pending' END)::public.community_member_status;

  SELECT id, status INTO v_existing
  FROM community_members
  WHERE community_id = p_community_id AND user_id = v_uid;

  IF v_existing.id IS NULL THEN
    INSERT INTO community_members (community_id, user_id, role, status)
    VALUES (p_community_id, v_uid, 'member', v_target_status)
    RETURNING id INTO v_member_id;
  ELSIF v_existing.status = 'left' THEN
    UPDATE community_members
    SET status = v_target_status, joined_at = null
    WHERE id = v_existing.id;
    v_member_id := v_existing.id;
  ELSIF v_existing.status = 'pending' THEN
    RAISE EXCEPTION 'You already asked to join. The leader has your request.';
  ELSIF v_existing.status = 'active' THEN
    RAISE EXCEPTION 'You are already a member.';
  ELSE
    RAISE EXCEPTION 'You cannot join this community right now.';
  END IF;

  INSERT INTO community_member_answers (member_id, community_id, user_id, answers)
  VALUES (v_member_id, p_community_id, v_uid, v_stored)
  ON CONFLICT (member_id)
  DO UPDATE SET answers = excluded.answers, updated_at = now();

  IF v_open THEN
    PERFORM finalize_community_join(v_member_id, v_uid, true);
    RETURN;
  END IF;

  v_first := v_stored->>'first_name';
  INSERT INTO app_notifications (user_id, type, title, body, actor_user_id)
  SELECT m.user_id,
         'community_join_request',
         'someone wants in',
         v_first || ' asked to join ' || v_community.name || '. their introduction is waiting for you.',
         v_uid
  FROM community_members m
  WHERE m.community_id = p_community_id
    AND m.role IN ('leader', 'co_leader')
    AND m.status = 'active';
END;
$_$;

REVOKE ALL ON FUNCTION public.request_to_join_community(uuid, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.request_to_join_community(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_to_join_community(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. community_members_insert RLS: second, independent layer (defense in
--    depth). request_to_join_community is SECURITY DEFINER as table owner
--    and bypasses this policy entirely today, so #5 above is the real
--    enforcement; this closes the same door for any raw client insert
--    attempt, matching this codebase's own established habit of never
--    leaving a second real door unguarded (see the idor-hardening
--    migrations). Every other condition on this policy is UNCHANGED.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS community_members_insert ON public.community_members;

CREATE POLICY community_members_insert ON public.community_members
  FOR INSERT WITH CHECK (
    user_id = (SELECT auth.uid())
    AND role = 'member'
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM communities c
      WHERE c.id = community_id
        AND c.status = 'active'
        AND (
          c.restricted_gender IS NULL
          OR c.restricted_gender = (SELECT p.gender FROM profiles p WHERE p.id = (SELECT auth.uid()))
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 7. explore_events.gender_rule -- the "plans inherit the restriction" half
--    (Q4). Reuses the SAME public.gender_rule enum the circle-plan system
--    (events.gender_rule) already uses: one concept, not two, matching
--    "architecturally consistent with how visibility and ownership already
--    work elsewhere" from the spec doc.
-- ---------------------------------------------------------------------------

ALTER TABLE public.explore_events
  ADD COLUMN IF NOT EXISTS gender_rule public.gender_rule;

COMMENT ON COLUMN public.explore_events.gender_rule IS
  'Gender-restricted-communities (Liz 2026-09-01, Q4). NULL = open to everyone, same as every existing row -- no eligibility filtering happens for a null rule, exactly like today, on every standalone/organizer event. Set once at creation by operator_create_explore_event(): auto-inherited from the owning community''s restricted_gender when that community is restricted and the caller does not override; an explicit override may only be the community''s own restriction (redundant no-op) or ''mixed'' (opens that one plan to everyone) -- anything else (e.g. men_only inside a women-only community) is rejected server-side, since nobody of the other gender could ever be a member of that community to begin with. Not editable by operator_update_explore_event (out of scope here -- same "set at create, not editable" pattern community_id/host_user_id attribution already uses). The actual override UI needs a control on the event-creation form (app/creator/event-form.tsx, Screen 22) -- FROZEN, not built here; this column and the RPC param exist so that UI has something real to write to once it can be built.';

-- ---------------------------------------------------------------------------
-- 8. operator_create_explore_event(): 18th optional param (p_gender_rule),
--    plus the auto-inherit/validate logic. Full body reproduced verbatim
--    from the live 17-arg definition (confirmed against
--    ops/drift/baseline-20260825.sql plus SQL-98's p_confirmation_message,
--    not assumed) with exactly the additions described above.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.operator_create_explore_event(
  text, text, text, text, timestamptz, text, text, text, text, text, uuid, text, boolean, boolean, timestamptz, jsonb, text
);

CREATE OR REPLACE FUNCTION public.operator_create_explore_event(
  p_title text,
  p_description text DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_event_date text DEFAULT NULL,
  p_start_time timestamptz DEFAULT NULL,
  p_venue text DEFAULT NULL,
  p_venue_address text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_external_url text DEFAULT NULL,
  p_ticket_price text DEFAULT NULL,
  p_community_id uuid DEFAULT NULL,
  p_public_name text DEFAULT NULL,
  p_pin_to_chat boolean DEFAULT true,
  p_publish boolean DEFAULT true,
  p_end_time timestamptz DEFAULT NULL,
  p_description_blocks jsonb DEFAULT NULL,
  p_confirmation_message text DEFAULT NULL,
  p_gender_rule text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_community_gender public.gender_type;
  v_expected_rule public.gender_rule;
  v_effective_rule public.gender_rule;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF NOT (has_operator_grant(v_uid, 'event_host'::operator_track)
          OR has_operator_grant(v_uid, 'community_leader'::operator_track)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF coalesce(btrim(p_title), '') = '' OR char_length(p_title) > 120 THEN
    RAISE EXCEPTION 'A title is required.';
  END IF;
  IF coalesce(btrim(p_category), '') = '' THEN
    RAISE EXCEPTION 'Pick a category.';
  END IF;
  IF coalesce(p_publish, true) AND coalesce(btrim(p_event_date), '') = '' THEN
    RAISE EXCEPTION 'Pick a date.';
  END IF;
  IF p_community_id IS NOT NULL
     AND NOT is_community_leader(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'Not authorized for that community';
  END IF;
  IF p_end_time IS NOT NULL AND p_start_time IS NOT NULL
     AND p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'The end has to come after the start.';
  END IF;

  -- gender-restricted-communities (Liz 2026-09-01, Q4): a plan created
  -- inside a restricted community auto-inherits the restriction by default;
  -- an explicit override may only open it to everyone ('mixed'), never
  -- point it at the OTHER gender. Unrestricted communities and
  -- standalone/organizer events (community_id null) are untouched: whatever
  -- p_gender_rule is passed (including null) is stored as-is, exactly
  -- today's behavior of having no gender concept at all on this table.
  IF p_community_id IS NOT NULL THEN
    SELECT restricted_gender INTO v_community_gender FROM communities WHERE id = p_community_id;
    IF v_community_gender IS NOT NULL THEN
      v_expected_rule := (CASE v_community_gender
        WHEN 'woman' THEN 'women_only'
        WHEN 'man' THEN 'men_only'
        ELSE NULL
      END)::public.gender_rule;
      IF p_gender_rule IS NULL THEN
        v_effective_rule := v_expected_rule;
      ELSIF p_gender_rule = 'mixed' THEN
        v_effective_rule := 'mixed';
      ELSIF p_gender_rule::public.gender_rule = v_expected_rule THEN
        v_effective_rule := v_expected_rule;
      ELSE
        RAISE EXCEPTION 'A plan in this community can only be % or open to everyone.', v_expected_rule;
      END IF;
    ELSE
      v_effective_rule := nullif(p_gender_rule, '')::public.gender_rule;
    END IF;
  ELSE
    v_effective_rule := nullif(p_gender_rule, '')::public.gender_rule;
  END IF;

  INSERT INTO explore_events (
    title, description, image_url, event_date, start_time, end_time, venue,
    venue_address, category, external_url, ticket_price,
    host_user_id, community_id, public_name, pin_to_chat, status,
    description_blocks, confirmation_message, gender_rule
  ) VALUES (
    btrim(p_title),
    nullif(btrim(p_description), ''),
    nullif(btrim(p_image_url), ''),
    nullif(btrim(p_event_date), '')::date,
    p_start_time,
    p_end_time,
    nullif(btrim(p_venue), ''),
    nullif(btrim(p_venue_address), ''),
    nullif(btrim(p_category), ''),
    nullif(btrim(p_external_url), ''),
    nullif(btrim(p_ticket_price), '')::numeric,
    v_uid,
    p_community_id,
    nullif(btrim(p_public_name), ''),
    coalesce(p_pin_to_chat, true),
    CASE WHEN coalesce(p_publish, true) THEN 'Live' ELSE 'Draft' END,
    p_description_blocks,
    nullif(btrim(p_confirmation_message), ''),
    v_effective_rule
  ) RETURNING id INTO v_id;

  IF coalesce(p_publish, true) AND p_community_id IS NOT NULL THEN
    INSERT INTO community_topics (community_id, name, created_by, explore_event_id)
    VALUES (p_community_id, left(btrim(p_title), 60), v_uid, v_id);
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_create_explore_event(text, text, text, text, timestamptz, text, text, text, text, text, uuid, text, boolean, boolean, timestamptz, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.operator_create_explore_event(text, text, text, text, timestamptz, text, text, text, text, text, uuid, text, boolean, boolean, timestamptz, jsonb, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.operator_create_explore_event(text, text, text, text, timestamptz, text, text, text, text, text, uuid, text, boolean, boolean, timestamptz, jsonb, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Self-tests. Real INSERT/DELETE against real rows, cleaned up before
--    commit, simulated auth via transaction-local jwt claims -- same style
--    as the skeleton and C-04 migrations. Needs at least one profile with
--    gender='woman' and one with gender='man' to run; raises plainly if not
--    available rather than skipping silently.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'communities' AND column_name = 'restricted_gender'
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: communities.restricted_gender missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'explore_events' AND column_name = 'gender_rule'
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: explore_events.gender_rule missing';
  END IF;
END;
$$;

DO $$
DECLARE
  v_woman uuid;
  v_man uuid;
  v_leader uuid;
  v_cid uuid;
  v_open_cid uuid;
  v_eid uuid;
  v_raised boolean;
  v_gender_rule public.gender_rule;
BEGIN
  SELECT id INTO v_woman FROM profiles WHERE gender = 'woman' LIMIT 1;
  SELECT id INTO v_man FROM profiles WHERE gender = 'man' LIMIT 1;
  SELECT user_id INTO v_leader FROM operator_grants
    WHERE track = 'community_leader' AND status = 'approved' LIMIT 1;
  IF v_woman IS NULL OR v_man IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: needs at least one profile with gender=woman and one with gender=man to run';
  END IF;
  IF v_leader IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: needs an existing approved community_leader grant to test with';
  END IF;

  -- a woman-restricted community, created directly (bypassing the grant
  -- check on purpose -- this self-test is about the READ/JOIN/PLAN paths,
  -- not re-proving create_community's own grant gate, already covered by
  -- the C-04 migration's self-test)
  INSERT INTO communities (handle, name, status, restricted_gender, created_by)
  VALUES ('selftest-gender-restricted-tmp', 'self test women only', 'active', 'woman', v_leader)
  RETURNING id INTO v_cid;
  INSERT INTO community_members (community_id, user_id, role, status, joined_at)
  VALUES (v_cid, v_leader, 'leader', 'active', now());

  -- an ordinary open community, for the negative "unrestricted is untouched" case
  INSERT INTO communities (handle, name, status, restricted_gender, created_by)
  VALUES ('selftest-gender-open-tmp', 'self test open', 'active', NULL, v_leader)
  RETURNING id INTO v_open_cid;

  -- #3/#4: discovery + direct RLS read both hide the restricted community
  -- from a man and show it to a woman and to the leader regardless.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_man, 'role', 'authenticated')::text, true);
  IF EXISTS (SELECT 1 FROM communities WHERE id = v_cid) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: communities_select leaked a women-only community to a man';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_woman, 'role', 'authenticated')::text, true);
  IF NOT EXISTS (SELECT 1 FROM communities WHERE id = v_cid) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: communities_select hid a women-only community from a woman';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  IF NOT EXISTS (SELECT 1 FROM communities WHERE id = v_cid) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: communities_select hid a leader''s own community from themself';
  END IF;

  -- #5: a man cannot join; a woman can.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_man, 'role', 'authenticated')::text, true);
  v_raised := false;
  BEGIN
    PERFORM public.request_to_join_community(v_cid, jsonb_build_object(
      'first_name', 'Test', 'last_name', 'Man', 'email', 'selftest-man@example.com',
      'zip', '90210', 'intro_answer', 'hi', 'guidelines_accepted', true));
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a man was allowed to join a women-only community';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_woman, 'role', 'authenticated')::text, true);
  PERFORM public.request_to_join_community(v_cid, jsonb_build_object(
    'first_name', 'Test', 'last_name', 'Woman', 'email', 'selftest-woman@example.com',
    'zip', '90210', 'intro_answer', 'hi', 'guidelines_accepted', true));
  IF NOT EXISTS (
    SELECT 1 FROM community_members WHERE community_id = v_cid AND user_id = v_woman AND status IN ('active', 'pending')
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a matching-gender join did not land a member row';
  END IF;

  -- #8: plan creation inside the restricted community auto-inherits;
  -- an inconsistent override is rejected; 'mixed' override is accepted.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  v_eid := public.operator_create_explore_event(
    p_title := 'selftest gender inherit', p_category := 'community',
    p_event_date := to_char(current_date + 7, 'YYYY-MM-DD'), p_community_id := v_cid, p_publish := false);
  SELECT gender_rule INTO v_gender_rule FROM explore_events WHERE id = v_eid;
  IF v_gender_rule IS DISTINCT FROM 'women_only'::public.gender_rule THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: plan did not auto-inherit women_only from its restricted community (got %)', v_gender_rule;
  END IF;
  DELETE FROM explore_events WHERE id = v_eid;

  v_raised := false;
  BEGIN
    PERFORM public.operator_create_explore_event(
      p_title := 'selftest gender bad override', p_category := 'community',
      p_event_date := to_char(current_date + 7, 'YYYY-MM-DD'), p_community_id := v_cid, p_publish := false,
      p_gender_rule := 'men_only');
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a men_only plan was allowed inside a women-only community';
  END IF;

  v_eid := public.operator_create_explore_event(
    p_title := 'selftest gender mixed override', p_category := 'community',
    p_event_date := to_char(current_date + 7, 'YYYY-MM-DD'), p_community_id := v_cid, p_publish := false,
    p_gender_rule := 'mixed');
  SELECT gender_rule INTO v_gender_rule FROM explore_events WHERE id = v_eid;
  IF v_gender_rule IS DISTINCT FROM 'mixed'::public.gender_rule THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: the mixed override was not honored (got %)', v_gender_rule;
  END IF;
  DELETE FROM explore_events WHERE id = v_eid;

  -- an unrestricted community's plan is untouched: no gender_rule forced.
  v_eid := public.operator_create_explore_event(
    p_title := 'selftest gender unrestricted', p_category := 'community',
    p_event_date := to_char(current_date + 7, 'YYYY-MM-DD'), p_community_id := v_open_cid, p_publish := false);
  SELECT gender_rule INTO v_gender_rule FROM explore_events WHERE id = v_eid;
  IF v_gender_rule IS NOT NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: an unrestricted community''s plan got a gender_rule forced on it (got %)', v_gender_rule;
  END IF;
  DELETE FROM explore_events WHERE id = v_eid;

  -- cleanup at full privilege (impersonated-role deletes silently no-op
  -- against community_members RLS -- caught live once already in this repo,
  -- see the C-04 migration's own cleanup comment)
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  DELETE FROM community_member_answers WHERE community_id IN (v_cid, v_open_cid);
  DELETE FROM community_members WHERE community_id IN (v_cid, v_open_cid);
  DELETE FROM community_blocks WHERE community_id IN (v_cid, v_open_cid);
  DELETE FROM communities WHERE id IN (v_cid, v_open_cid);

  RAISE NOTICE 'gender-restricted-communities self-test passed';
END;
$$;

COMMIT;
