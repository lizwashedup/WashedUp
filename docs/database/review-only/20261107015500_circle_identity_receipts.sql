-- PRIVATE / HELD. Requires production-schema copy verification and separate approval.
-- The legacy update_circle contract remains unchanged. Receipts make an explicit
-- retry of the same identity save safe even if the original reply was lost.
BEGIN;
CREATE TABLE public.circle_identity_receipts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('saved', 'conflict')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, request_id)
);
ALTER TABLE public.circle_identity_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.circle_identity_receipts FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.circle_identity_save_status(p_circle_id uuid, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE u uuid := auth.uid(); receipt public.circle_identity_receipts; revision timestamptz;
BEGIN
  IF u IS NULL OR NOT public.is_circle_admin(p_circle_id, u) THEN
    RAISE EXCEPTION 'only an admin can update this circle' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO receipt FROM public.circle_identity_receipts WHERE user_id=u AND request_id=p_request_id;
  IF FOUND THEN
    IF receipt.circle_id <> p_circle_id THEN RAISE EXCEPTION 'request belongs to another circle' USING ERRCODE='22023'; END IF;
    RETURN jsonb_build_object('status',receipt.outcome);
  END IF;
  SELECT updated_at INTO revision FROM public.circles WHERE id=p_circle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'circle unavailable' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('status','missing','revision',revision);
END $$;

CREATE FUNCTION public.save_circle_identity_once(
  p_circle_id uuid, p_request_id uuid, p_expected_revision timestamptz,
  p_name text, p_description text, p_cover_upload_id uuid DEFAULT NULL, p_clear_cover boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE u uuid := auth.uid(); receipt public.circle_identity_receipts; revision timestamptz;
  chosen jsonb; outcome text;
BEGIN
  IF u IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
  IF NOT public.is_circle_admin(p_circle_id,u) THEN
    RAISE EXCEPTION 'only an admin can update this circle' USING ERRCODE='42501';
  END IF;
  chosen := jsonb_build_object('revision',p_expected_revision,'name',p_name,'description',p_description,
    'cover',p_cover_upload_id,'clear',p_clear_cover);
  -- Serialize by receipt, including requests for different circles using the same key.
  PERFORM pg_advisory_xact_lock(hashtextextended(u::text || ':' || p_request_id::text,0));
  SELECT * INTO receipt FROM public.circle_identity_receipts WHERE user_id=u AND request_id=p_request_id;
  IF FOUND THEN
    IF receipt.circle_id <> p_circle_id OR receipt.payload IS DISTINCT FROM chosen THEN
      RAISE EXCEPTION 'save request does not match the original' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('status',receipt.outcome);
  END IF;
  SELECT updated_at INTO revision FROM public.circles WHERE id=p_circle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'circle unavailable' USING ERRCODE='P0002'; END IF;
  -- Recheck the existing admin predicate after waiting for the circle row.
  IF NOT public.is_circle_admin(p_circle_id,u) THEN RAISE EXCEPTION 'only an admin can update this circle' USING ERRCODE='42501'; END IF;
  IF revision IS DISTINCT FROM p_expected_revision THEN
    outcome := 'conflict';
  ELSE
    -- Preserve the identity subset of update_circle in one row update. Do not
    -- produce a second realtime/trigger event just to advance the revision.
    UPDATE public.circles SET
      name=COALESCE(NULLIF(btrim(p_name),''),name),
      description=COALESCE(p_description,description),
      cover_upload_id=CASE WHEN p_cover_upload_id IS NOT NULL THEN p_cover_upload_id
        WHEN p_clear_cover THEN NULL ELSE cover_upload_id END,
      updated_at=GREATEST(clock_timestamp(),updated_at + interval '1 microsecond')
    WHERE id=p_circle_id;
    outcome := 'saved';
  END IF;
  INSERT INTO public.circle_identity_receipts(user_id,request_id,circle_id,payload,outcome)
    VALUES(u,p_request_id,p_circle_id,chosen,outcome);
  RETURN jsonb_build_object('status',outcome);
END $$;
REVOKE ALL ON FUNCTION public.circle_identity_save_status(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.save_circle_identity_once(uuid,uuid,timestamptz,text,text,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.circle_identity_save_status(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_circle_identity_once(uuid,uuid,timestamptz,text,text,uuid,boolean) TO authenticated;
COMMIT;
