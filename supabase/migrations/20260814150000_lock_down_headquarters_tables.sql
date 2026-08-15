-- Headquarters admin tables (investors, growth_cards, tools, documents,
-- strategy_answers, quick_captures, content_cards) are internal-only data for
-- washedup-world's admin dashboard. Confirmed live 2026-08-14: washedup-world
-- exclusively reads/writes all 7 via its server-side SUPABASE_SERVICE_ROLE_KEY
-- client (src/lib/supabase/server.ts, every /api/{investors,tools,capture,
-- growth,strategy,docs} route), never a browser/anon/authenticated client.
--
-- Each table currently carries a leftover "Users own their X" policy
-- (auth.uid() = user_id, roles: public, cmd: ALL) plus a full anon+
-- authenticated table grant. Live-tested 2026-08-14: a real anon SELECT
-- against investors/strategy_answers/documents returns 0 rows right now
-- (auth.uid() is NULL for anon, NULL = user_id is never true), so this is not
-- an active data leak today. But it is accidental, not designed: the policy
-- does not fit this data (a company does not have "your own" investors), the
-- grant is unnecessary, and it depends on user_id semantics nobody is
-- verifying, on every write path too, not just the read path this migration
-- happened to test.
--
-- ORDERING, DO NOT APPLY OUT OF SEQUENCE: command-center-next (being
-- decommissioned, still live as of this file being written) is the other
-- real consumer of anon access to these 7 tables, reading them directly from
-- the browser with the anon key (its password wall only gates page routes,
-- not the direct-to-Supabase calls, per WASHEDUP-CANONICAL-MAP-20260813.md
-- section 2d). Applying this before command-center-next is confirmed dead
-- (ADMIN_PASSWORD unset + deploy paused) will break its Headquarters pages
-- immediately. Kill command-center-next first, then apply this.
--
-- Fix: drop the stray ownership policy, revoke the anon+authenticated table
-- grants entirely. RLS stays enabled with zero policies for those two roles,
-- the strictest possible state (deny all). service_role is unaffected: it
-- carries BYPASSRLS in Supabase by default and was never granted through
-- these revoked grants in the first place.

BEGIN;

DO $$
DECLARE
  t text;
  pol record;
BEGIN
  FOREACH t IN ARRAY ARRAY['investors','growth_cards','tools','documents','strategy_answers','quick_captures','content_cards']
  LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      RAISE NOTICE 'dropping % policy % (stray per-user policy, does not fit Headquarters-only data)', t, pol.policyname;
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;

-- Self-test: RLS on and zero anon/authenticated grants on all 7, plus a live
-- cross-role probe proving anon genuinely cannot read (or even attempt to
-- read) investors anymore, not just that the query happens to return 0 rows.
DO $$
DECLARE
  t text;
  v_n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['investors','growth_cards','tools','documents','strategy_answers','quick_captures','content_cards']
  LOOP
    IF NOT COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass), false) THEN
      RAISE EXCEPTION 'self-test failed: % RLS is not enabled', t;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'authenticated')
    ) THEN
      RAISE EXCEPTION 'self-test failed: % still has an anon/authenticated grant', t;
    END IF;
  END LOOP;

  BEGIN
    SET LOCAL ROLE anon;
    EXECUTE 'SELECT count(*) FROM public.investors' INTO v_n;
    RESET ROLE;
    RAISE EXCEPTION 'self-test failed: anon could still execute a SELECT against investors and got % row(s) back (expected permission denied)', v_n;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE 'anon probe passed: permission denied on investors, grant fully revoked';
    WHEN OTHERS THEN
      RESET ROLE;
      RAISE;
  END;
END $$;

COMMIT;
