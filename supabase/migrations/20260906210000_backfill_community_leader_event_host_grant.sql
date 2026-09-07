-- DRAFT: DO NOT APPLY WITHOUT JOSH'S WORD.
--
-- One-time backfill for Q3 (LIZ-OPEN-QUESTIONS.md "RESOLVED" section / master plan v3 §8):
-- "when Organization approval and Community approval split into two separate things, do
-- today's existing creators keep both automatically, or do they have to apply for the
-- second one?" Resolved 2026-09-01 via this document's own pre-agreed reversible default:
-- grant both approvals for whatever a creator already operates. Not a clean Liz
-- confirmation -- her actual transcript quote describes today's rule, not a direct answer to
-- the post-split question -- closed anyway via the default already written down for exactly
-- this case. Full detail in LIZ-OPEN-QUESTIONS.md.
--
-- Distinct from Screen 47's own steady-state acceptance criterion ("Approval for one never
-- creates or unlocks the other", unchanged and re-affirmed by 20260906190000, applied in
-- this same batch): that governs applications submitted AFTER the split lands, going
-- forward, for everyone. This migration is the one-time transition for people who were
-- already operating both under today's understanding, per Liz's own description of today's
-- rule on the 9/1 call: "if you apply and you're a community leader you can have an
-- organization and do organizational events but if you have an organization you can't do
-- the community stuff you don't need to" -- one-directional. community_leader implies
-- event_host; the reverse is never granted here, on purpose.
--
-- In practice this makes nothing NEW possible: a community leader already gets the 'full'
-- creator shell today (lib/creatorMode.ts isLeaderAccess -> creatorShellKind), which lets
-- them create/manage events regardless of hasEventHostGrant. What this backfill actually
-- fixes is that the newer Organization/Community workspace-selection layer
-- (lib/workspaceContext.ts resolveWorkspace) reads hasOrganization strictly off an approved
-- event_host grant -- without this backfill, a community leader who has always been able to
-- put on organizational events would be unable to explicitly select the "organization"
-- workspace for that same, already-real capability.
--
-- Scope, deliberately narrow -- read this before ever applying:
--   * Only an APPROVED community_leader grant qualifies as "already operates" a community.
--   * Only a user with ZERO event_host row (no status at all, ever) gets a new row.
--   * A community leader who already HAS an event_host row -- applied, in_review,
--     needs_more_info, declined, approved, revoked, or withdrawn -- is left completely
--     untouched. That row reflects either an in-flight process or a real human decision (an
--     admin's decline or revoke) this backfill has no business silently overriding.
--   * The reverse direction (an approved event_host grantee automatically receiving
--     community_leader) is deliberately NOT done -- Liz's own words above rule it out.
--
-- NOT applied anywhere, NOT run against a live or disposable Postgres this session (no
-- working harness -- see 20260906190000's header for the same caveat, same reason). This
-- also means the affected row count is unknown: whoever applies this should run the SELECT
-- half of the backfill query on its own first and eyeball the count and the actual user list
-- before running the real INSERT, and spot-check one affected account's fetchMyGrants()
-- result afterward. Needs a real apply-and-test pass and Josh's explicit go before this can
-- ever be called done, per this repo's own Release Discipline (clients/washed-up/CLAUDE.md).

BEGIN;

WITH backfilled AS (
  INSERT INTO public.operator_grants
    (user_id, track, status, application, terms_accepted_at, reviewed_at, applicant_message)
  SELECT
    g.user_id,
    'event_host'::public.operator_track,
    'approved'::public.operator_grant_status,
    jsonb_build_object(
      'auto_granted', true,
      'auto_granted_reason', 'q3_community_leader_carries_event_host',
      'auto_granted_from_grant_id', g.id,
      'auto_granted_at', now()
    ),
    g.terms_accepted_at,  -- they already accepted the (track-agnostic) creator terms once
    now(),
    'you already lead a community, which comes with putting on organizational events too -- no separate application needed.'
  FROM public.operator_grants g
  WHERE g.track = 'community_leader'
    AND g.status = 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM public.operator_grants g2
      WHERE g2.user_id = g.user_id AND g2.track = 'event_host'
    )
  RETURNING user_id
)
-- Warm in-app note, same table/type/shape admin_review_operator_grant's 'approved' outcome
-- uses (see 20260702190455_operator_applications.sql), so this doesn't read differently in
-- a creator's inbox from a real human approval. Scoped to exactly the rows just inserted
-- above via the CTE, not a second independent guess at who was touched.
INSERT INTO public.app_notifications (user_id, type, title, body)
SELECT
  user_id,
  'operator_grant',
  'you can put on events too',
  'you already lead a community, which comes with putting on organizational events -- no separate application needed. a real person is still around if you have questions.'
FROM backfilled;

-- ---------------------------------------------------------------------------
-- self-test: the invariant this migration exists to establish (never strip on apply)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_missing integer;
BEGIN
  SELECT count(*) INTO v_missing
  FROM public.operator_grants g
  WHERE g.track = 'community_leader'
    AND g.status = 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM public.operator_grants g2
      WHERE g2.user_id = g.user_id AND g2.track = 'event_host'
    );
  IF v_missing > 0 THEN
    RAISE EXCEPTION
      'SELF-TEST FAIL: % approved community_leader grant(s) still have no event_host row after backfill',
      v_missing;
  END IF;
END;
$$;

COMMIT;
