-- ===========================================================================
-- REVIEW ONLY - NOT YET APPLIED (await Liz's go-ahead).
--
-- Request-card copy (M3). Rewrites context_line in get_incoming_people_requests
-- to lead with real shared history and fall back to a gendered line instead of
-- the generic "Found you on WashedUp" (copy-system doc, "Incoming request card"):
--   plan_history     -> "You were both on {plan}"        (kept; strongest cue)
--   referral_invite  -> "{Name} invited you to WashedUp" (kept)
--   else (handle/..) -> "wants to add you to {his/her/their} people"
--
-- Pronoun by gender: man->his, woman->her, else (non_binary OR null)->their.
-- NOTE: 149 prod profiles currently have gender = NULL (legacy, pre safety-lock);
-- they fall through to "their". Flag for Liz: backfill those, or keep "their".
--
-- NAME-IN-LINE DECISION (Liz's call at review): the card already shows {Name}
-- as the title, so the fallback here OMITS the name ("wants to add you to her
-- people") to avoid "Sage / Sage wants to add you...". The copy-system doc's
-- literal is "{Name} wants to add you to {pronoun} people"; the existing
-- referral_invite variant DOES repeat the name. If you'd rather match the doc
-- literally, prepend: COALESCE(pr.first_name_display,'They') || ' '.
--
-- Signature unchanged (same RETURN TABLE columns) - only the context_line
-- expression and the gender read change.
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.get_incoming_people_requests(p_user_id uuid)
  RETURNS TABLE (
    connection_id      uuid,
    requester_user_id  uuid,
    first_name_display text,
    profile_photo_url  text,
    handle             text,
    context            text,
    context_event_id   uuid,
    context_event_title text,
    context_line       text,
    requested_at       timestamptz
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    pc.id,
    pc.requester_user_id,
    pr.first_name_display,
    pr.profile_photo_url,
    pr.handle,
    pc.context,
    pc.context_event_id,
    ev.title,
    CASE pc.context
      WHEN 'plan_history' THEN
        'You were both on ' || COALESCE(ev.title, 'a plan')
      WHEN 'referral_invite' THEN
        COALESCE(pr.first_name_display, 'They') || ' invited you to WashedUp'
      ELSE
        'wants to add you to '
        || CASE pr.gender
             WHEN 'man'   THEN 'his'
             WHEN 'woman' THEN 'her'
             ELSE 'their'
           END
        || ' people'
    END AS context_line,
    pc.requested_at
  FROM public.people_connections pc
  JOIN public.profiles pr ON pr.id = pc.requester_user_id
  LEFT JOIN public.events ev ON ev.id = pc.context_event_id
  WHERE pc.recipient_user_id = p_user_id
    AND pc.status = 'pending'
    AND NOT public.yours_is_blocked_between(p_user_id, pc.requester_user_id)
  ORDER BY pc.requested_at DESC;
END;
$$;

-- --- in-transaction self-test (rolls back; leaves no trace) -----------------
DO $$
DECLARE
  v_me   uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';   -- Liz
  v_them uuid := 'cafe0001-0000-0000-0000-000000000001';   -- Sage (test)
  v_line text;
BEGIN
  BEGIN
    DELETE FROM public.user_blocks WHERE blocker_id = v_me AND blocked_id = v_them;
    DELETE FROM public.people_connections
      WHERE requester_user_id = v_them AND recipient_user_id = v_me;
    INSERT INTO public.people_connections
      (requester_user_id, recipient_user_id, status, context, can_re_request)
    VALUES (v_them, v_me, 'pending', 'handle_lookup', true);

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_me, 'role', 'authenticated')::text, true);

    SELECT context_line INTO v_line
    FROM public.get_incoming_people_requests(v_me)
    WHERE requester_user_id = v_them;

    IF v_line NOT LIKE 'wants to add you to %people' THEN
      RAISE EXCEPTION 'self-test: handle_lookup fallback wrong (got "%")', v_line;
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'get_incoming_people_requests self-test passed';
END $$;

COMMIT;
