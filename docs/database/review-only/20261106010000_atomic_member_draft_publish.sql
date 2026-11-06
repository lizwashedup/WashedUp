BEGIN;

-- Tagged plan inserts and draft publications create their membership atomically.
-- Older clients omit this key and keep their separate membership write.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS member_draft_publish_key uuid;

CREATE OR REPLACE FUNCTION public.join_creator_on_member_draft_publish()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM NEW.creator_user_id
    OR (TG_OP = 'UPDATE' AND (NEW.creator_user_id IS DISTINCT FROM OLD.creator_user_id OR NEW.id IS DISTINCT FROM OLD.id)) THEN
    RAISE EXCEPTION 'Only the original plan creator can publish this draft' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.event_members
    WHERE event_id = NEW.id AND user_id = NEW.creator_user_id AND role = 'host' AND status = 'joined'
  ) THEN
    INSERT INTO public.event_members(event_id, user_id, role, status)
      VALUES (NEW.id, NEW.creator_user_id, 'host', 'joined');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.join_creator_on_member_draft_publish() FROM PUBLIC;
CREATE OR REPLACE TRIGGER join_creator_on_member_draft_publish
AFTER UPDATE OF member_draft_publish_key ON public.events
FOR EACH ROW WHEN (OLD.status = 'draft' AND NEW.status = 'forming' AND NEW.member_draft_publish_key IS NOT NULL)
EXECUTE FUNCTION public.join_creator_on_member_draft_publish();

CREATE OR REPLACE TRIGGER join_creator_on_member_plan_insert
AFTER INSERT ON public.events
FOR EACH ROW WHEN (NEW.status = 'forming' AND NEW.member_draft_publish_key IS NOT NULL)
EXECUTE FUNCTION public.join_creator_on_member_draft_publish();

NOTIFY pgrst, 'reload schema';
COMMIT;
