-- Run after the fictional members/interest fixture in a disposable database.
ALTER TABLE public.event_members ADD COLUMN role text, ADD COLUMN status text;
GRANT SELECT, INSERT ON public.event_members TO authenticated;
ALTER TABLE public.event_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_own_membership ON public.event_members FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY insert_own_membership ON public.event_members FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid());
SET ROLE authenticated;
SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
DO $$
DECLARE
  plan uuid := gen_random_uuid();
  legacy uuid := gen_random_uuid();
  refused uuid := gen_random_uuid();
  receipt uuid := gen_random_uuid();
  me uuid := auth.uid();
BEGIN
  INSERT INTO public.events(id,title,status) VALUES(plan,'Private test draft','draft'),(legacy,'Older client','draft'),(refused,'Conflicting membership','draft');
  UPDATE public.events SET status='forming',member_draft_publish_key=receipt WHERE id=plan AND status='draft';
  IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=plan AND member_draft_publish_key=receipt AND status='forming')
    OR NOT EXISTS(SELECT 1 FROM public.event_members WHERE event_id=plan AND user_id=me AND status='joined' AND role='host') THEN
    RAISE EXCEPTION 'Publication and creator membership must commit together';
  END IF;
  UPDATE public.events SET status='forming',member_draft_publish_key=receipt WHERE id=plan AND status='draft';
  IF FOUND THEN RAISE EXCEPTION 'Repeat publication changed an already published plan'; END IF;
  IF EXISTS(SELECT 1 FROM public.events WHERE id=plan AND member_draft_publish_key=gen_random_uuid()) THEN
    RAISE EXCEPTION 'A different request matched the receipt';
  END IF;
  UPDATE public.events SET status='forming' WHERE id=legacy;
  IF EXISTS(SELECT 1 FROM public.event_members WHERE event_id=legacy) THEN RAISE EXCEPTION 'Legacy write unexpectedly created membership'; END IF;

  INSERT INTO public.event_members(event_id,user_id,role,status) VALUES(refused,me,'participant','left');
  BEGIN
    UPDATE public.events SET status='forming',member_draft_publish_key=gen_random_uuid() WHERE id=refused;
    RAISE EXCEPTION 'Expected conflicting membership to reject publish';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=refused AND status='draft' AND member_draft_publish_key IS NULL) THEN
    RAISE EXCEPTION 'Membership failure did not roll back publication';
  END IF;
  PERFORM set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  UPDATE public.events SET status='forming',member_draft_publish_key=gen_random_uuid() WHERE id=refused;
  IF FOUND THEN RAISE EXCEPTION 'A different account published the draft'; END IF;
END;
$$;
-- A new draft's primary key also identifies a retry after a lost receipt.
DO $$
DECLARE
  draft uuid := gen_random_uuid();
  me uuid := auth.uid();
BEGIN
  INSERT INTO public.events(id,title,status) VALUES(draft,'First version','draft') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.events(id,title,status) VALUES(draft,'Revised title','draft') ON CONFLICT (id) DO NOTHING;
  IF FOUND THEN RAISE EXCEPTION 'A retry inserted another draft'; END IF;
  UPDATE public.events SET title='Revised title' WHERE id=draft AND creator_user_id=me AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Retry failed to save current edits'; END IF;
  PERFORM set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  UPDATE public.events SET title='Wrong account' WHERE id=draft AND creator_user_id=auth.uid() AND status='draft';
  IF FOUND THEN RAISE EXCEPTION 'Another account replaced draft content'; END IF;
  PERFORM set_config('request.jwt.claim.sub',me::text,true);
  UPDATE public.events SET status='forming' WHERE id=draft;
  INSERT INTO public.events(id,title,status) VALUES(draft,'Stale retry','draft') ON CONFLICT (id) DO NOTHING;
  UPDATE public.events SET title='Stale retry' WHERE id=draft AND creator_user_id=me AND status='draft';
  IF FOUND OR NOT EXISTS (SELECT 1 FROM public.events WHERE id=draft AND status='forming' AND title='Revised title') THEN
    RAISE EXCEPTION 'Stale retry changed the published plan';
  END IF;
END;
$$;
RESET ROLE;
