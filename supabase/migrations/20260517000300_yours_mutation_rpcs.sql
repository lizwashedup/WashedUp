-- Yours page rebuild — 4/6: mutation RPCs.
--
-- REVIEW ONLY. Not applied by the agent. See 1/6..3/6 headers.
-- Writes only (rows). Notifications are fired by triggers in 5/6 so this
-- file never touches the protected push edge functions and follows the
-- project rule "prefer a new trigger over modifying an existing one".
--
-- Re-request rules (spec):
--   * Decline: the requester can never re-request; the decliner may
--     re-initiate (their own opposite-direction row, untouched).
--   * Remove: only the remover may re-initiate; the removed person cannot.
-- Both enforced via can_re_request on the blocked initiator's directional
-- row + the send guard below.
--
-- All SECURITY DEFINER, pinned search_path, auth.uid()-scoped. Idempotent.

BEGIN;

-- send_people_request -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_people_request(
  p_recipient uuid,
  p_context text,
  p_context_event_id uuid DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_recipient IS NULL OR p_recipient = v_me THEN
    RAISE EXCEPTION 'invalid_recipient';
  END IF;
  IF p_context NOT IN ('plan_history','search','referral_invite') THEN
    RAISE EXCEPTION 'invalid_context';
  END IF;
  IF public.yours_is_blocked_between(v_me, p_recipient) THEN
    RAISE EXCEPTION 'blocked';
  END IF;
  IF public.yours_is_connected(v_me, p_recipient) THEN
    RAISE EXCEPTION 'already_connected';
  END IF;
  -- Guard: my directional row toward them is frozen (they declined me, or
  -- they removed me).
  IF EXISTS (
    SELECT 1 FROM public.people_connections pc
    WHERE pc.requester_user_id = v_me
      AND pc.recipient_user_id = p_recipient
      AND pc.can_re_request = false
      AND pc.status IN ('declined','removed')
  ) THEN
    RAISE EXCEPTION 'cannot_re_request';
  END IF;

  INSERT INTO public.people_connections AS pc
    (requester_user_id, recipient_user_id, status, context,
     context_event_id, requested_at, responded_at)
  VALUES
    (v_me, p_recipient, 'pending', p_context, p_context_event_id, now(), NULL)
  ON CONFLICT (requester_user_id, recipient_user_id) DO UPDATE
    SET status = 'pending',
        context = EXCLUDED.context,
        context_event_id = EXCLUDED.context_event_id,
        requested_at = now(),
        responded_at = NULL
    WHERE pc.can_re_request = true;
END;
$$;

-- accept_people_request -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_people_request(p_requester uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_rows int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE public.people_connections
    SET status = 'accepted', responded_at = now()
  WHERE requester_user_id = p_requester
    AND recipient_user_id = v_me
    AND status = 'pending';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'no_pending_request'; END IF;
END;
$$;

-- decline_people_request (optionally block) ---------------------------------
CREATE OR REPLACE FUNCTION public.decline_people_request(
  p_requester uuid,
  p_block boolean DEFAULT false
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_rows int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE public.people_connections
    SET status = 'declined', responded_at = now(), can_re_request = false
  WHERE requester_user_id = p_requester
    AND recipient_user_id = v_me
    AND status = 'pending';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'no_pending_request'; END IF;

  IF p_block THEN
    INSERT INTO public.user_blocks (blocker_id, blocked_id)
    VALUES (v_me, p_requester)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

-- remove_connection ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_connection(p_other uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  -- Tear down whichever accepted row exists for the pair.
  UPDATE public.people_connections
    SET status = 'removed', responded_at = now()
  WHERE status = 'accepted'
    AND ((requester_user_id = v_me AND recipient_user_id = p_other)
      OR (requester_user_id = p_other AND recipient_user_id = v_me));

  -- Freeze the removed person's ability to re-initiate (only the remover
  -- may). Their directional row (other -> me) gets can_re_request=false;
  -- create it if it never existed so the send guard always catches them.
  INSERT INTO public.people_connections
    (requester_user_id, recipient_user_id, status, context,
     requested_at, responded_at, can_re_request)
  VALUES
    (p_other, v_me, 'removed', 'search', now(), now(), false)
  ON CONFLICT (requester_user_id, recipient_user_id) DO UPDATE
    SET status = 'removed', responded_at = now(), can_re_request = false;

  -- Keep the remover free to re-initiate later.
  UPDATE public.people_connections
    SET can_re_request = true
  WHERE requester_user_id = v_me AND recipient_user_id = p_other;
END;
$$;

-- set_plan_visibility -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_plan_visibility(
  p_global boolean DEFAULT NULL,
  p_person uuid DEFAULT NULL,
  p_hidden boolean DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF p_global IS NOT NULL THEN
    UPDATE public.profiles SET plans_visible_to_people = p_global
    WHERE id = v_me;
  END IF;

  IF p_person IS NOT NULL AND p_hidden IS NOT NULL THEN
    IF p_person = v_me THEN RAISE EXCEPTION 'invalid_person'; END IF;
    INSERT INTO public.people_plan_visibility
      (owner_user_id, viewer_user_id, hidden, updated_at)
    VALUES (v_me, p_person, p_hidden, now())
    ON CONFLICT (owner_user_id, viewer_user_id) DO UPDATE
      SET hidden = EXCLUDED.hidden, updated_at = now();
  END IF;
END;
$$;

-- ping_person ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ping_person(
  p_recipient uuid,
  p_event_id uuid
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_recipient = v_me THEN RAISE EXCEPTION 'invalid_recipient'; END IF;
  IF public.yours_is_blocked_between(v_me, p_recipient) THEN
    RAISE EXCEPTION 'blocked';
  END IF;
  -- 24h dedupe for the same (sender, recipient, event).
  IF EXISTS (
    SELECT 1 FROM public.people_pings
    WHERE sender_user_id = v_me AND recipient_user_id = p_recipient
      AND event_id = p_event_id AND sent_at > now() - interval '24 hours'
  ) THEN
    RETURN; -- idempotent: silently skip a repeat ping
  END IF;
  INSERT INTO public.people_pings
    (sender_user_id, recipient_user_id, event_id)
  VALUES (v_me, p_recipient, p_event_id);
END;
$$;

-- ensure_referral_code ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_referral_code(p_user_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text;
  v_attempt int := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT referral_code INTO v_code FROM public.profiles WHERE id = p_user_id;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;

  LOOP
    v_attempt := v_attempt + 1;
    -- 7 chars from an unambiguous uppercase alphabet (no 0/O/1/I).
    -- Uses core random(); no pgcrypto dependency.
    v_code := '';
    FOR i IN 1..7 LOOP
      v_code := v_code || substr(
        'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
        1 + floor(random() * 32)::int, 1);
    END LOOP;
    BEGIN
      UPDATE public.profiles SET referral_code = v_code WHERE id = p_user_id;
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 10 THEN
        RAISE EXCEPTION 'referral_code_collision';
      END IF;
    END;
  END LOOP;
END;
$$;

-- record_referral_invite ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_referral_invite(
  p_phone_hash text,
  p_contact_name text DEFAULT NULL
) RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_code text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_phone_hash IS NULL OR length(p_phone_hash) < 16 THEN
    RAISE EXCEPTION 'invalid_phone_hash';
  END IF;

  v_code := public.ensure_referral_code(v_me);

  INSERT INTO public.referral_invites
    (inviter_user_id, invited_phone_hash, invited_contact_name,
     referral_code, status)
  VALUES (v_me, p_phone_hash, p_contact_name, v_code, 'pending')
  ON CONFLICT (inviter_user_id, invited_phone_hash) DO UPDATE
    SET invited_contact_name = COALESCE(EXCLUDED.invited_contact_name,
                                        public.referral_invites.invited_contact_name),
        invited_at = now()
  WHERE public.referral_invites.status = 'pending';

  RETURN v_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.send_people_request(uuid,text,uuid),
  public.accept_people_request(uuid),
  public.decline_people_request(uuid,boolean),
  public.remove_connection(uuid),
  public.set_plan_visibility(boolean,uuid,boolean),
  public.ping_person(uuid,uuid),
  public.ensure_referral_code(uuid),
  public.record_referral_invite(text,text)
  FROM anon, public;
GRANT EXECUTE ON FUNCTION
  public.send_people_request(uuid,text,uuid),
  public.accept_people_request(uuid),
  public.decline_people_request(uuid,boolean),
  public.remove_connection(uuid),
  public.set_plan_visibility(boolean,uuid,boolean),
  public.ping_person(uuid,uuid),
  public.ensure_referral_code(uuid),
  public.record_referral_invite(text,text)
  TO authenticated;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname='public' AND p.prosecdef AND p.proname IN
    ('send_people_request','accept_people_request','decline_people_request',
     'remove_connection','set_plan_visibility','ping_person',
     'ensure_referral_code','record_referral_invite');
  IF n < 8 THEN
    RAISE EXCEPTION 'self-test: expected 8 SECURITY DEFINER mutation RPCs, found %', n;
  END IF;
END $$;

COMMIT;
