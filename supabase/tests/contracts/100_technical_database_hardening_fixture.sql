\set ON_ERROR_STOP on

CREATE EXTENSION dblink;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE SCHEMA auth;

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  banned_until timestamptz
);

CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
);

CREATE TABLE auth.refresh_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL
);

CREATE FUNCTION public.normalize_email(addr text) RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  local_part text;
  domain_part text;
BEGIN
  IF addr IS NULL THEN RETURN NULL; END IF;
  addr := lower(trim(addr));
  local_part := split_part(addr, '@', 1);
  domain_part := split_part(addr, '@', 2);
  IF domain_part IN ('gmail.com', 'googlemail.com') THEN
    local_part := split_part(local_part, '+', 1);
    local_part := replace(local_part, '.', '');
    RETURN local_part || '@gmail.com';
  END IF;
  RETURN addr;
END;
$$;

CREATE FUNCTION public.phash_distance_256(a text, b text) RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE WHEN lower(a) = lower(b) THEN 0 ELSE 256 END $$;

CREATE TABLE public.organizer_receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_user_id uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  consumed_cents integer NOT NULL DEFAULT 0
    CHECK (consumed_cents BETWEEN 0 AND amount_cents),
  reason text NOT NULL DEFAULT 'processing_shortfall',
  settled_at timestamptz,
  last_stripe_payout_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.blocked_payout_source (
  organizer_user_id uuid PRIMARY KEY,
  gross_due_cents integer NOT NULL,
  receivable_outstanding_cents integer NOT NULL
);

CREATE FUNCTION public.list_ticket_payouts_blocked()
RETURNS TABLE (
  organizer_user_id uuid,
  gross_due_cents integer,
  receivable_outstanding_cents integer
)
LANGUAGE sql STABLE
AS $$
  SELECT b.organizer_user_id, b.gross_due_cents, b.receivable_outstanding_cents
  FROM public.blocked_payout_source b;
$$;

CREATE TABLE public.explore_events (
  id uuid PRIMARY KEY
);

CREATE TABLE public.ticket_orders (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.explore_events(id),
  qty integer NOT NULL CHECK (qty BETWEEN 1 AND 50),
  status text NOT NULL CHECK (status IN ('pending', 'paid', 'canceled', 'refunded')),
  needs_refund_review boolean NOT NULL DEFAULT false,
  refund_review_reason text,
  refund_review_flagged_at timestamptz
);

CREATE TABLE public.ticket_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.explore_events(id),
  scope text NOT NULL DEFAULT 'per_order' CHECK (scope IN ('per_order', 'per_attendee')),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.ticket_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.ticket_orders(id),
  question_id uuid NOT NULL REFERENCES public.ticket_questions(id),
  attendee_index integer,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (attendee_index IS NULL OR attendee_index BETWEEN 1 AND 50)
);

CREATE TABLE public.banned_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  normalized_email text,
  phone_number text,
  photo_hash text
);

CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid NOT NULL,
  reported_user_id uuid,
  reason text NOT NULL
);

CREATE TABLE public.moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  target_user_id uuid,
  reason text NOT NULL,
  performed_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.tg_ticket_answers_validate() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RETURN new; END $$;

CREATE FUNCTION public.tg_ticket_questions_cap() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RETURN new; END $$;

CREATE FUNCTION public.auto_ban_reported_user() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RETURN new; END $$;

CREATE TRIGGER ticket_answers_validate
BEFORE INSERT OR UPDATE OF order_id, question_id, attendee_index
ON public.ticket_answers
FOR EACH ROW EXECUTE FUNCTION public.tg_ticket_answers_validate();

CREATE TRIGGER ticket_questions_cap
BEFORE INSERT OR UPDATE OF is_active, event_id
ON public.ticket_questions
FOR EACH ROW EXECUTE FUNCTION public.tg_ticket_questions_cap();

CREATE TRIGGER on_report_auto_ban
AFTER INSERT ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.auto_ban_reported_user();
