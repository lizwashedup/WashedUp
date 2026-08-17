\set ON_ERROR_STOP on

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE TABLE public.ticket_orders (
  id uuid PRIMARY KEY,
  status text NOT NULL
);

INSERT INTO public.ticket_orders (id, status) VALUES
  ('30000000-0000-0000-0000-000000000001', 'paid');

CREATE EXTENSION dblink;
