-- ============================================================================
-- Build 35 Screen 37 (app/community-thread/[id].tsx, the main Community
-- chat): a main-chat display name, decoupled from the community's own name.
--
-- Re-verified this session: `main_chat_name` returns zero hits across every
-- migration and every lib/ file. The main stream itself
-- (community_broadcasts, keyed by community_id, permanent by construction --
-- 20260706150000_mvp_batch.sql / 20260708220000_open_composer.sql) has no
-- row of its own to carry a name on: it is not a community_topics row, and
-- this migration does not create one. Creating a topic row here would be
-- exactly the "another topic row masquerading as the main chat" shape the
-- Build 35 delta matrix calls out to avoid, and it would walk straight into
-- Screen 18's still-undecided legacy-room disposition question. The one
-- clean place for a per-community chat display name is communities itself
-- -- one row per community, matching community_broadcasts' own community_id
-- key.
--
-- Deliberately NOT done here: backfilling this from whatever legacy room
-- happens to be a community's current de facto main room (e.g. "After
-- Glow", named in the delta matrix's own evidence for this screen). Which
-- legacy rooms survive, get archived, or get migrated is exactly Screen
-- 18's open question -- Liz said hold off on 2026-09-01, explicitly not
-- mine to touch. Every community, new and existing, gets this migration's
-- own plain default and nothing else; no read of community_topics happens
-- anywhere in this file.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.communities') IS NULL THEN
    RAISE EXCEPTION 'main-chat-name dependency missing: public.communities';
  END IF;
  IF to_regprocedure('public.get_my_community_chat_cards()') IS NULL THEN
    RAISE EXCEPTION 'main-chat-name dependency missing: public.get_my_community_chat_cards() (20260707120000_event_chat_model.sql)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. communities.main_chat_name. Nullable (no NOT NULL) so a future rename
--    UI can clear it back to the default; the DEFAULT below still backfills
--    every existing row to a real value rather than leaving them null and
--    relying only on client-side fallback.
-- ---------------------------------------------------------------------------

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS main_chat_name text DEFAULT 'community chat';

COMMENT ON COLUMN public.communities.main_chat_name IS
  'Screen 37: the main persistent chat''s own display name, independent of communities.name. Nullable so a future rename UI can clear it back to the default; the client and get_my_community_chat_cards() both fall back to "community chat" when null. Deliberately not backfilled from any legacy room name -- see Screen 18 (community room consolidation) for that still-open, separately-decided question.';

-- ---------------------------------------------------------------------------
-- 2. get_my_community_chat_cards(): one new key on each card. Body
--    reproduced verbatim from the live 20260707120000_event_chat_model.sql
--    definition; the ONLY change is the added 'main_chat_name' key.
--
--    MERGE NOTE for whoever applies 20260901040000_community_archive_member_access.sql
--    (also DRAFT, also redefines this same function -- its only change is
--    the join condition, `c.status = 'active'` -> `c.status in ('active',
--    'archived')`): whichever of these two applies second must carry the
--    other's change forward too, same merge-order rule this repo already
--    uses for create_community's own pending forks (see that migration's
--    own header, and 20260902200000's "Sequencing note").
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
          'main_chat_name', c.main_chat_name,
          'accent_color', c.accent_color,
          'role', m.role,
          'latest_broadcast', lb.broadcast,
          'unread_broadcasts', coalesce(ub.n, 0),
          'topics', coalesce(tp.topics, '[]'::jsonb),
          'unread_total', coalesce(ub.n, 0) + coalesce(tp.unread_topics_total, 0),
          'last_activity_at', greatest(lb.latest_at, tp.latest_message_at)
        ) as card
        from community_members m
        join communities c on c.id = m.community_id and c.status = 'active'
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

REVOKE ALL ON FUNCTION public.get_my_community_chat_cards() FROM public;
REVOKE ALL ON FUNCTION public.get_my_community_chat_cards() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_community_chat_cards() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Self-test: the default applies to a freshly created community, the RPC
--    surfaces it, and an explicit rename round-trips through both.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_leader uuid;
  v_cid uuid;
  v_probe_handle text := 'selftest-mainchatname-' || substr(md5(random()::text), 1, 8);
  v_stored_name text;
  v_cards jsonb;
  v_card jsonb;
BEGIN
  SELECT user_id INTO v_leader FROM public.operator_grants
    WHERE track = 'community_leader' AND status = 'approved' LIMIT 1;
  IF v_leader IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: needs an existing approved community_leader grant to test with';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_cid := public.create_community(v_probe_handle, 'selftest main chat name');

  -- default applies to a freshly created community
  RESET ROLE;
  SELECT main_chat_name INTO v_stored_name FROM public.communities WHERE id = v_cid;
  IF v_stored_name IS DISTINCT FROM 'community chat' THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: main_chat_name did not default to community chat (got %)', v_stored_name;
  END IF;

  -- the RPC surfaces it, as the member who was just seated as leader
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_cards := (public.get_my_community_chat_cards())->'cards';
  SELECT c INTO v_card FROM jsonb_array_elements(v_cards) c WHERE c->>'community_id' = v_cid::text;
  IF v_card IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: the just-created community did not appear in its own cards';
  END IF;
  IF v_card->>'main_chat_name' IS DISTINCT FROM 'community chat' THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: get_my_community_chat_cards did not surface the default main_chat_name (got %)', v_card->>'main_chat_name';
  END IF;

  -- an explicit rename round-trips through both the column and the RPC
  RESET ROLE;
  UPDATE public.communities SET main_chat_name = 'after glow' WHERE id = v_cid;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_cards := (public.get_my_community_chat_cards())->'cards';
  SELECT c INTO v_card FROM jsonb_array_elements(v_cards) c WHERE c->>'community_id' = v_cid::text;
  IF v_card->>'main_chat_name' IS DISTINCT FROM 'after glow' THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: an explicit main_chat_name did not round-trip through the RPC (got %)', v_card->>'main_chat_name';
  END IF;

  -- cleanup at full privilege (impersonated-role deletes silently no-op
  -- against community_members RLS -- same caught-live precedent as the
  -- join-policy-at-creation migration's own cleanup comment)
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  DELETE FROM public.community_members WHERE community_id = v_cid;
  DELETE FROM public.community_blocks WHERE community_id = v_cid;
  DELETE FROM public.communities WHERE id = v_cid;

  RAISE NOTICE 'main_chat_name self-test passed';
END;
$$;

COMMIT;
