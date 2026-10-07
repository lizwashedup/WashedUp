-- Close one uncertain attendance attempt without replaying its write.
-- Existing RSVP RLS, upsert, membership and notification triggers stay intact.
BEGIN;

CREATE TABLE public.event_rsvp_settlements (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.explore_events(id) ON DELETE CASCADE,
  attempt_updated_at timestamptz NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id, attempt_updated_at)
);
ALTER TABLE public.event_rsvp_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_rsvp_settlements FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.guard_settled_event_rsvp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('event-rsvp:' || NEW.user_id::text || ':' || NEW.explore_event_id::text || ':' || extract(epoch FROM NEW.updated_at)::text, 0));
  IF EXISTS (SELECT 1 FROM public.event_rsvp_settlements s
    WHERE s.user_id=NEW.user_id AND s.event_id=NEW.explore_event_id AND s.attempt_updated_at=NEW.updated_at) THEN
    RAISE EXCEPTION 'This attendance attempt has already been settled. Check your current attendance.' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_settled_event_rsvp() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER event_rsvp_settlement_guard
  BEFORE INSERT OR UPDATE ON public.explore_event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.guard_settled_event_rsvp();

CREATE FUNCTION public.settle_event_rsvp(p_event_id uuid, p_updated_at timestamptz, p_going boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_status text;
  v_updated_at timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to check attendance.' USING ERRCODE='42501'; END IF;
  IF p_event_id IS NULL OR p_updated_at IS NULL OR NOT isfinite(p_updated_at) OR p_going IS NULL THEN
    RAISE EXCEPTION 'Invalid attendance attempt.' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('event-rsvp:' || v_user::text || ':' || p_event_id::text || ':' || extract(epoch FROM p_updated_at)::text, 0));
  -- A deleted event already rejects any late RSVP through its original FK.
  IF NOT EXISTS (SELECT 1 FROM public.explore_events WHERE id=p_event_id) THEN
    RETURN jsonb_build_object('kind','settled','event_id',p_event_id,'user_id',v_user,'attempt_updated_at',p_updated_at,'status',NULL);
  END IF;
  INSERT INTO public.event_rsvp_settlements(user_id,event_id,attempt_updated_at)
    VALUES(v_user,p_event_id,p_updated_at) ON CONFLICT DO NOTHING;
  SELECT r.status,r.updated_at INTO v_status,v_updated_at FROM public.explore_event_rsvps r
    WHERE r.explore_event_id=p_event_id AND r.user_id=v_user;
  RETURN jsonb_build_object(
    'kind',CASE WHEN v_status=CASE WHEN p_going THEN 'going' ELSE 'cancelled' END AND v_updated_at=p_updated_at THEN 'confirmed' ELSE 'settled' END,
    'event_id',p_event_id,'user_id',v_user,'attempt_updated_at',p_updated_at,'status',v_status);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_event_rsvp(uuid,timestamptz,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_event_rsvp(uuid,timestamptz,boolean) TO authenticated;

COMMIT;
