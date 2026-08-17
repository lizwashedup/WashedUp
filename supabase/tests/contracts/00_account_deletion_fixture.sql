\set ON_ERROR_STOP on

CREATE SCHEMA auth;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY
);

CREATE TABLE public.user_roles (
  user_id uuid NOT NULL,
  role text NOT NULL,
  CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role)
);

CREATE TABLE public.email_verification_codes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  code text NOT NULL
);

CREATE TABLE public.sms_verification_codes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  code text NOT NULL
);

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000001', 'creator'),
  ('00000000-0000-0000-0000-000000000002', 'creator');

INSERT INTO public.email_verification_codes (id, user_id, code) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'target'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'survivor');

INSERT INTO public.sms_verification_codes (id, user_id, code) VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'target'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'survivor');
