-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
-- ============================================================================
-- Community archive (soft-delete): close the "no way to remove a community
-- once created" gap without ever hard-deleting a row.
--
-- NO NEW COLUMN. communities.status is already a community_status enum
-- ('draft', 'active', 'archived') created on day one by
-- 20260702184012_communities_skeleton.sql -- 'archived' has been a valid
-- label since that original CREATE TYPE, never a later ALTER TYPE ... ADD
-- VALUE, so writing it is exactly as safe as the 'active'/'draft' writes
-- publishCommunity()/unpublishCommunity() already do in prod. The comment on
-- that original enum already reads "archived: wound down, hidden, data
-- kept." -- nothing here repurposes the column, it finally wires up the
-- third label that was reserved for this from the start.
--
-- lib/creatorMode.ts's archiveCommunity() flips status -> archived through
-- the existing leader-scoped communities_update RLS policy (same mechanism
-- publishCommunity() already uses for draft -> active), so THAT write needed
-- no schema change at all. This migration exists only for the READ side of
-- the product rule ("existing members keep their chat history and access to
-- what they already had, only new discovery is closed off"):
--
--   ALREADY CORRECT, verified, not touched here:
--     - get_discoverable_communities() (20260706150000_mvp_batch.sql) already
--       filters `where c.status = 'active'`, so an archived community drops
--       out of discovery/browse/search the moment status flips, same as a
--       draft always has. This is the whole "hidden from new discovery" half
--       of the rule, and it already just works.
--     - communities_select, community_topics_select,
--       community_topic_messages_select, community_members_select (all in
--       the skeleton migration) gate on is_community_member(...) /
--       is_community_leader(...) / the row's own user_id, independent of
--       communities.status. An existing member's read of the bare community
--       row, the topic list, and every chat message they could already see
--       is untouched by archiving.
--     - get_community_member_count() (20260704162720) is a SECURITY DEFINER
--       function granted to anon and is deliberately status-gated ("no
--       probing draft or archived sizes" per its own header) so a stranger
--       cannot enumerate the size of a wound-down community. Left alone on
--       purpose: it is a privacy control, not a bug, and it does not gate
--       any content -- an archived community's own member count badge going
--       quiet is a cosmetic loss, not an access loss.
--
--   TWO REAL GAPS FOUND, fixed below (confirmed by reading the live SQL, not
--   guessed):
--     1. get_my_community_chat_cards() (redefined by
--        20260707120000_event_chat_model.sql, the live version) joins
--        `communities c on c.id = m.community_id and c.status = 'active'`.
--        This is the RPC behind the Chats tab's community section: as
--        written, archiving a community would silently drop its card from
--        EVERY existing member's Chats list, cutting off the one path
--        members actually use to reach their own chat history. Fixed by
--        widening that join to `c.status in ('active', 'archived')` --
--        drafts stay excluded exactly as before, only archived is added.
--     2. community_blocks_select (skeleton migration) is
--        `(visible and exists(... c.status = 'active')) or
--        is_community_leader(...) or is_admin(...)`. A LEADER/co_leader/
--        admin-tier member keeps seeing page blocks (the is_community_leader
--        branch does not check status), but a plain member or
--        events/member_care/finance-tier member has no such branch: once
--        status leaves 'active' they would lose the community's page
--        content (cover, about, event blocks) entirely. Fixed by adding the
--        same is_community_member(...) carve-out communities_select already
--        uses, inside the visible-block branch, so any existing member (any
--        role) keeps the page once published, archived or not. Anon/
--        non-member visibility is unchanged (still requires status =
--        'active').
--
-- Also updated lib/communityPage.ts's getMyCommunities() (pure app code, no
-- migration needed) to keep an archived community listed under Yours for
-- members/leaders who already belong to it, instead of only 'active'.
--
-- ADDITIVE-BEHAVIOR ONLY: no column added, no row touched, no privilege
-- widened for anon/non-members. Both fixes only ADD visibility for someone
-- who already qualifies as a member of the row in question.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.get_my_community_chat_cards()') IS NULL THEN
    RAISE EXCEPTION 'community-archive dependency missing: public.get_my_community_chat_cards() (20260707120000_event_chat_model.sql)';
  END IF;
  IF to_regclass('public.community_blocks') IS NULL THEN
    RAISE EXCEPTION 'community-archive dependency missing: public.community_blocks (20260702184012_communities_skeleton.sql)';
  END IF;
  IF to_regprocedure('public.is_community_member(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'community-archive dependency missing: public.is_community_member(uuid,uuid) (20260702184012_communities_skeleton.sql)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Chats tab: a member's own archived community keeps its card.
--    Full body copied verbatim from the live 20260707120000 definition; the
--    ONLY change is the join condition on line "join communities c on ...".
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_community_chat_cards()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select jsonb_build_object(
    'cards',
    coalesce((
      select jsonb_agg(card order by (card->>'last_activity_at') desc nulls last)
      from (
        select jsonb_build_object(
          'community_id', c.id,
          'handle', c.handle,
          'name', c.name,
          'accent_color', c.accent_color,
          'role', m.role,
          'latest_broadcast', lb.broadcast,
          'unread_broadcasts', coalesce(ub.n, 0),
          'topics', coalesce(tp.topics, '[]'::jsonb),
          'unread_total', coalesce(ub.n, 0) + coalesce(tp.unread_topics_total, 0),
          'last_activity_at', greatest(lb.latest_at, tp.latest_message_at)
        ) as card
        from community_members m
        -- WAS: and c.status = 'active'. An archived community is still a
        -- community an existing active member keeps their card for; only a
        -- never-published draft has no card, same as before.
        join communities c on c.id = m.community_id and c.status in ('active', 'archived')
        left join lateral (
          select jsonb_build_object(
                   'id', b.id, 'body', b.body, 'created_at', b.created_at,
                   'sender_id', b.sender_id
                 ) as broadcast,
                 b.created_at as latest_at
          from community_broadcasts b
          where b.community_id = c.id
          order by b.created_at desc
          limit 1
        ) lb on true
        left join lateral (
          select count(*)::integer as n
          from community_broadcasts b
          where b.community_id = c.id
            and b.sender_id is distinct from auth.uid()
            and b.created_at > coalesce(
              (select r.last_read_at from community_broadcast_reads r
               where r.community_id = c.id and r.user_id = auth.uid()),
              m.joined_at, m.created_at)
        ) ub on true
        left join lateral (
          select jsonb_agg(jsonb_build_object(
                   'id', t.id,
                   'name', t.name,
                   'is_default', t.is_default,
                   'explore_event_id', t.explore_event_id,
                   'joined', (tm.user_id is not null),
                   'notifications_on', coalesce(tm.notifications_on, false),
                   'unread', coalesce(tu.n, 0),
                   'last_message_at', lm.latest_at
                 ) order by t.is_default desc, lm.latest_at desc nulls last) as topics,
                 sum(coalesce(tu.n, 0))::integer as unread_topics_total,
                 max(lm.latest_at) filter (where tm.user_id is not null) as latest_message_at
          from community_topics t
          left join community_topic_members tm
            on tm.topic_id = t.id and tm.user_id = auth.uid()
          left join lateral (
            select max(msg.created_at) as latest_at
            from community_topic_messages msg where msg.topic_id = t.id
          ) lm on true
          left join lateral (
            select count(*)::integer as n
            from community_topic_messages msg
            where msg.topic_id = t.id
              and tm.user_id is not null
              and msg.sender_id is distinct from auth.uid()
              and msg.created_at > coalesce(
                (select r.last_read_at from community_topic_reads r
                 where r.topic_id = t.id and r.user_id = auth.uid()),
                tm.joined_at)
          ) tu on true
          where t.community_id = c.id and not t.archived
        ) tp on true
        where m.user_id = auth.uid() and m.status = 'active'
      ) cards
    ), '[]'::jsonb),
    'attendee_topics',
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'name', t.name,
               'community_id', c.id,
               'community_name', c.name,
               'accent_color', c.accent_color,
               'explore_event_id', t.explore_event_id,
               'notifications_on', tm.notifications_on,
               'unread', coalesce((
                 select count(*)::integer
                 from community_topic_messages msg
                 where msg.topic_id = t.id
                   and msg.sender_id is distinct from auth.uid()
                   and msg.created_at > coalesce(
                     (select r.last_read_at from community_topic_reads r
                      where r.topic_id = t.id and r.user_id = auth.uid()),
                     tm.joined_at)
               ), 0),
               'last_message_at', (
                 select max(msg.created_at)
                 from community_topic_messages msg where msg.topic_id = t.id
               ),
               'joined_at', tm.joined_at
             ) order by tm.joined_at desc)
      from community_topic_members tm
      join community_topics t on t.id = tm.topic_id
      join communities c on c.id = t.community_id
      where tm.user_id = auth.uid()
        and t.explore_event_id is not null
        and not t.archived
        -- attendee = in the event chat WITHOUT community membership; members
        -- already get these topics inside their card
        and not exists (
          select 1 from community_members m
          where m.community_id = t.community_id
            and m.user_id = auth.uid() and m.status = 'active'
        )
    ), '[]'::jsonb)
  );
$$;

-- CREATE OR REPLACE FUNCTION does not change existing grants, but re-assert
-- them so this migration is correct standalone (matches the skeleton's own
-- house style of asserting grants next to the function they belong to).
REVOKE ALL ON FUNCTION public.get_my_community_chat_cards() FROM public;
REVOKE ALL ON FUNCTION public.get_my_community_chat_cards() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_community_chat_cards() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Community page blocks: any existing member (not just leader-tier) keeps
--    seeing the page once it is archived, not only while it was active.
--    Anon/non-member visibility is untouched (still requires status =
--    'active').
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS community_blocks_select ON public.community_blocks;

CREATE POLICY community_blocks_select ON public.community_blocks
  FOR SELECT USING (
    (
      visible
      AND (
        EXISTS (SELECT 1 FROM communities c WHERE c.id = community_id AND c.status = 'active')
        OR is_community_member(community_id, (select auth.uid()))
      )
    )
    OR is_community_leader(community_id, (select auth.uid()))
    OR is_admin((select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 3. Read-only self-test (never strip on apply).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_qual text;
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.get_my_community_chat_cards()', 'execute') THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: authenticated cannot execute get_my_community_chat_cards';
  END IF;
  IF has_function_privilege('anon', 'public.get_my_community_chat_cards()', 'execute') THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: anon must not execute get_my_community_chat_cards';
  END IF;

  SELECT qual INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'community_blocks' AND policyname = 'community_blocks_select';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: community_blocks_select policy missing after replace';
  END IF;
  IF v_qual NOT LIKE '%is_community_member%' THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: community_blocks_select does not carve out is_community_member: %', v_qual;
  END IF;
END $$;

COMMIT;
