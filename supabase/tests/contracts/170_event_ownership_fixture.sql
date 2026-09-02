\set ON_ERROR_STOP on

-- Fixture for Build 35 / P3 batch A item A1 (event ownership). Companion to
-- supabase/migrations/20260901010000_build35_event_ownership.sql.
--
-- Written for A4 (master plan v3 §5.1; see
-- clients/washed-up/specs/washedup-BUILD35-EVENT-OWNERSHIP-20260831.md §8,
-- which explicitly says the insert-path, cascade, and invariant-2 cases
-- proven once in a scratch container "should be written into
-- supabase/tests/contracts/ ... so they run on every release rather than
-- once in a scratch container"). This is that write-up.
--
-- Minimal stand-ins for auth.users, public.communities, and
-- public.explore_events matching the live shape confirmed in that spec's
-- §1.1: host_user_id and community_id are BOTH nullable, BOTH
-- ON DELETE SET NULL. public.ticket_orders and public.explore_event_rsvps
-- are trimmed to only the columns the migration's own trigger function
-- reads (event_id/status and explore_event_id/status respectively).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;

CREATE TABLE public.communities (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE public.explore_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  status       text NOT NULL DEFAULT 'Live',
  host_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL
);
COMMENT ON COLUMN public.explore_events.host_user_id IS 'pre-A1 creator/ownership pair, as production has it today';

CREATE TABLE public.ticket_orders (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.explore_events(id) ON DELETE CASCADE,
  status   text NOT NULL
);

CREATE TABLE public.explore_event_rsvps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  explore_event_id uuid NOT NULL REFERENCES public.explore_events(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'going' CHECK (status IN ('going', 'cancelled'))
);

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-000000000001'), -- organization host, also co-creates on Community A
  ('00000000-0000-0000-0000-000000000002'), -- organization host for the solo/committed-guest rows
  ('00000000-0000-0000-0000-000000000003'), -- sole host of a row; this user gets deleted (R7)
  ('00000000-0000-0000-0000-000000000009'); -- RSVP guest

INSERT INTO public.communities (id, name) VALUES
  ('40000000-0000-0000-0000-000000000001', 'Community A (stays)'),
  ('40000000-0000-0000-0000-000000000002', 'Community B (gets deleted)');

-- Nine pre-existing rows, mirroring the three real production ownership
-- buckets from the spec's §1.2 live read (community+host / host-only /
-- neither), plus the rows this contract needs to exercise invariant 2 and
-- both cascade-delete destinations (organization and platform).
INSERT INTO public.explore_events (id, title, status, host_user_id, community_id) VALUES
  ('50000000-0000-0000-0000-000000000001', 'Community mixer',       'Live', '00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', 'Solo trivia night',     'Live', '00000000-0000-0000-0000-000000000002', NULL),
  ('50000000-0000-0000-0000-000000000003', 'Admin-curated pop-up',  'Live', NULL, NULL),
  ('50000000-0000-0000-0000-000000000004', 'Sold-out paint night',  'Live', '00000000-0000-0000-0000-000000000002', NULL),
  ('50000000-0000-0000-0000-000000000005', 'Free park meetup',      'Live', '00000000-0000-0000-0000-000000000002', NULL),
  ('50000000-0000-0000-0000-000000000006', 'Unsold new listing',    'Live', '00000000-0000-0000-0000-000000000002', NULL),
  ('50000000-0000-0000-0000-000000000007', 'Community B mixer',     'Live', '00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002'),
  ('50000000-0000-0000-0000-000000000008', 'Community B pop-up',    'Live', NULL,                                    '40000000-0000-0000-0000-000000000002'),
  ('50000000-0000-0000-0000-000000000009', 'Host C one-off',        'Live', '00000000-0000-0000-0000-000000000003', NULL);

-- Event 4 has a paid ticket order: a committed guest via money.
INSERT INTO public.ticket_orders (event_id, status) VALUES
  ('50000000-0000-0000-0000-000000000004', 'paid');

-- Event 5 has only an active RSVP, no ticket: still committed per §4.3
-- ("a free RSVP is the same commitment from the guest's side").
INSERT INTO public.explore_event_rsvps (explore_event_id, user_id, status) VALUES
  ('50000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000009', 'going');

SELECT 'FIXTURE: 9 pre-existing explore_events across community/organization/platform, one paid order, one active RSVP' AS result;
