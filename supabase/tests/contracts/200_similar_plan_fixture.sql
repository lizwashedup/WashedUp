CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.explore_events (id uuid PRIMARY KEY, title text, status text);
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id uuid NOT NULL DEFAULT auth.uid(),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'forming',
  explore_event_id uuid REFERENCES public.explore_events(id)
);
-- Deployed function shape, verified read-only before changing the attachment.
CREATE FUNCTION public.auto_link_explore_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_explore_id uuid;
BEGIN
  IF NEW.explore_event_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_explore_id FROM explore_events
    WHERE status = 'Live' AND lower(trim(title)) = lower(trim(NEW.title)) LIMIT 1;
  IF v_explore_id IS NOT NULL THEN NEW.explore_event_id := v_explore_id; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER auto_link_explore_event_trigger BEFORE INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.auto_link_explore_event();
CREATE TEMP TABLE original_function AS SELECT md5(pg_get_functiondef('public.auto_link_explore_event()'::regprocedure)) AS digest;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_events ON public.events TO authenticated USING (creator_user_id=auth.uid()) WITH CHECK (creator_user_id=auth.uid());
GRANT SELECT, INSERT, UPDATE ON public.events TO authenticated;
INSERT INTO public.explore_events VALUES
 ('20000000-0000-4000-8000-000000000001','Salsa party','Live'),
 ('20000000-0000-4000-8000-000000000002','Different event','Live');
