\set ON_ERROR_STOP on

CREATE SCHEMA vault;
CREATE SCHEMA net;

CREATE TABLE vault.decrypted_secrets (
  name text PRIMARY KEY,
  decrypted_secret text
);

CREATE TABLE public.test_http_capture (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  url text NOT NULL,
  body jsonb NOT NULL,
  headers jsonb NOT NULL
);

CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  capture_id bigint;
BEGIN
  INSERT INTO public.test_http_capture (url, body, headers)
  VALUES (url, body, headers)
  RETURNING id INTO capture_id;
  RETURN capture_id;
END;
$$;

CREATE TABLE public.reports (
  id uuid PRIMARY KEY,
  reason text NOT NULL
);

CREATE TABLE public.events (
  id uuid PRIMARY KEY,
  title text NOT NULL
);

CREATE FUNCTION public.notify_report_alert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.notify_plan_posted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_report_inserted
AFTER INSERT ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.notify_report_alert();

CREATE TRIGGER on_plan_posted
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.notify_plan_posted();
