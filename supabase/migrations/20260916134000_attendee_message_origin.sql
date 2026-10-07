-- Local candidate. Pair with Scene notification readers/worker; no deployment authorized.
-- Keep the original destination of a delivered update after its event is removed.
-- This is message context, not a public event reference or access grant.
BEGIN;

ALTER TABLE public.app_notifications ADD COLUMN explore_event_origin_id uuid;
UPDATE public.app_notifications SET explore_event_origin_id=explore_event_id
 WHERE explore_event_id IS NOT NULL;
COMMENT ON COLUMN public.app_notifications.explore_event_origin_id IS
 'Immutable original Scene event identity. Retained for recipient message recovery when the live event foreign key becomes null.';

CREATE FUNCTION public.keep_attendee_message_origin()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.explore_event_id IS NOT NULL THEN
   IF NEW.type<>'broadcast' OR NEW.event_id IS NOT NULL THEN
    RAISE EXCEPTION 'Scene update cannot use a Plan notification target';
   END IF;
   NEW.explore_event_origin_id:=NEW.explore_event_id;
  ELSIF NEW.explore_event_origin_id IS NOT NULL THEN
   RAISE EXCEPTION 'Scene update requires its original event';
  END IF;
 ELSE
  IF NEW.explore_event_origin_id IS DISTINCT FROM OLD.explore_event_origin_id OR
     (NEW.explore_event_id IS DISTINCT FROM OLD.explore_event_id AND NEW.explore_event_id IS NOT NULL) OR
     (OLD.explore_event_origin_id IS NOT NULL AND (NEW.type<>'broadcast' OR NEW.event_id IS NOT NULL)) THEN
   RAISE EXCEPTION 'Delivered update context cannot change';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.keep_attendee_message_origin() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER attendee_message_origin BEFORE INSERT OR UPDATE OF explore_event_id,explore_event_origin_id,type,event_id
 ON public.app_notifications FOR EACH ROW EXECUTE FUNCTION public.keep_attendee_message_origin();

COMMIT;
