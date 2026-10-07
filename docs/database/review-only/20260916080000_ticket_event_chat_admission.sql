-- REVIEW ONLY: confirmed ticket holders join only their existing event topic.
-- Reuse the RSVP/topic subscription store and all existing read/write/notification policies.
BEGIN;
CREATE FUNCTION public.reconcile_event_chat_attendee(p_event_id uuid,p_user_id uuid,p_excluded_order_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_topic uuid; v_archived boolean; v_attending boolean;
BEGIN
 IF p_event_id IS NULL OR p_user_id IS NULL THEN RETURN; END IF;
 -- Serialize different orders, seats and RSVP changes for this event.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_event_id::text,0));
 SELECT id,archived INTO v_topic,v_archived FROM public.community_topics WHERE explore_event_id=p_event_id;
 IF v_topic IS NULL THEN RETURN; END IF;
 SELECT EXISTS(SELECT 1 FROM public.explore_event_rsvps WHERE explore_event_id=p_event_id AND user_id=p_user_id AND status='going')
  OR EXISTS(SELECT 1 FROM public.ticket_orders o JOIN public.ticket_order_positions s ON s.order_id=o.id
   WHERE o.event_id=p_event_id AND o.id IS DISTINCT FROM p_excluded_order_id AND o.status='paid' AND s.voided_at IS NULL
   AND coalesce((to_jsonb(s)->>'current_holder_user_id')::uuid,o.buyer_user_id)=p_user_id)
 INTO v_attending;
 IF v_attending THEN
  IF NOT v_archived THEN
   INSERT INTO public.community_topic_members(topic_id,user_id) VALUES(v_topic,p_user_id)
   ON CONFLICT(topic_id,user_id) DO NOTHING; -- joined_at and individual mute preferences stay intact
  END IF;
 ELSE
  DELETE FROM public.community_topic_members WHERE topic_id=v_topic AND user_id=p_user_id;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.reconcile_event_chat_attendee(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Keep the existing trigger and RSVP semantics; cancellation cannot remove a still-valid ticket holder.
CREATE OR REPLACE FUNCTION public.sync_event_chat_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN PERFORM public.reconcile_event_chat_attendee(OLD.explore_event_id,OLD.user_id); END IF;
 IF TG_OP<>'DELETE' THEN PERFORM public.reconcile_event_chat_attendee(NEW.explore_event_id,NEW.user_id); RETURN NEW; END IF;
 RETURN OLD;
END $$;

CREATE FUNCTION public.sync_ticket_order_event_chat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN
  PERFORM public.reconcile_event_chat_attendee(OLD.event_id,OLD.buyer_user_id,CASE WHEN TG_OP='DELETE' THEN OLD.id END);
  FOR v_user IN SELECT DISTINCT (to_jsonb(s)->>'current_holder_user_id')::uuid FROM public.ticket_order_positions s WHERE s.order_id=OLD.id LOOP
   PERFORM public.reconcile_event_chat_attendee(OLD.event_id,v_user,CASE WHEN TG_OP='DELETE' THEN OLD.id END);
  END LOOP;
 END IF;
 IF TG_OP<>'DELETE' THEN
  PERFORM public.reconcile_event_chat_attendee(NEW.event_id,NEW.buyer_user_id);
  FOR v_user IN SELECT DISTINCT (to_jsonb(s)->>'current_holder_user_id')::uuid FROM public.ticket_order_positions s WHERE s.order_id=NEW.id LOOP
   PERFORM public.reconcile_event_chat_attendee(NEW.event_id,v_user);
  END LOOP;
  RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.sync_ticket_order_event_chat() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ticket_order_event_chat AFTER INSERT OR UPDATE OF status,buyer_user_id,event_id ON public.ticket_orders
 FOR EACH ROW EXECUTE FUNCTION public.sync_ticket_order_event_chat();

CREATE TRIGGER ticket_order_event_chat_delete BEFORE DELETE ON public.ticket_orders
 FOR EACH ROW EXECUTE FUNCTION public.sync_ticket_order_event_chat();

CREATE FUNCTION public.sync_ticket_position_event_chat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event uuid; v_buyer uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN
  SELECT event_id,buyer_user_id INTO v_event,v_buyer FROM public.ticket_orders WHERE id=OLD.order_id;
  PERFORM public.reconcile_event_chat_attendee(v_event,coalesce((to_jsonb(OLD)->>'current_holder_user_id')::uuid,v_buyer));
 END IF;
 IF TG_OP<>'DELETE' THEN
  SELECT event_id,buyer_user_id INTO v_event,v_buyer FROM public.ticket_orders WHERE id=NEW.order_id;
  PERFORM public.reconcile_event_chat_attendee(v_event,coalesce((to_jsonb(NEW)->>'current_holder_user_id')::uuid,v_buyer));
  RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.sync_ticket_position_event_chat() FROM PUBLIC,anon,authenticated,service_role;
-- UPDATE also covers the approved holder column when its separate transfer migration is installed.
CREATE TRIGGER ticket_position_event_chat AFTER INSERT OR UPDATE OR DELETE ON public.ticket_order_positions
 FOR EACH ROW EXECUTE FUNCTION public.sync_ticket_position_event_chat();

CREATE FUNCTION public.sync_new_event_topic_attendees() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid;
BEGIN
 IF NEW.explore_event_id IS NULL OR NEW.archived THEN RETURN NEW; END IF;
 FOR v_user IN
  SELECT user_id FROM public.explore_event_rsvps WHERE explore_event_id=NEW.explore_event_id AND status='going'
  UNION SELECT coalesce((to_jsonb(s)->>'current_holder_user_id')::uuid,o.buyer_user_id)
  FROM public.ticket_orders o JOIN public.ticket_order_positions s ON s.order_id=o.id
  WHERE o.event_id=NEW.explore_event_id AND o.status='paid' AND s.voided_at IS NULL
 LOOP PERFORM public.reconcile_event_chat_attendee(NEW.explore_event_id,v_user); END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_new_event_topic_attendees() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER event_topic_existing_attendees AFTER INSERT ON public.community_topics
 FOR EACH ROW EXECUTE FUNCTION public.sync_new_event_topic_attendees();

-- Recover valid existing ticket holders only; leave every other existing subscription/history intact.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT o.event_id,coalesce((to_jsonb(s)->>'current_holder_user_id')::uuid,o.buyer_user_id) user_id
  FROM public.ticket_orders o JOIN public.ticket_order_positions s ON s.order_id=o.id
  JOIN public.community_topics t ON t.explore_event_id=o.event_id
  WHERE o.status='paid' AND s.voided_at IS NULL AND NOT t.archived
 LOOP PERFORM public.reconcile_event_chat_attendee(r.event_id,r.user_id); END LOOP;
END $$;
COMMIT;
