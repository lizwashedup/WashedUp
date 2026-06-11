-- ===========================================================================
-- NOT YET APPLIED. Batch 3, file 2/8. Reviewed at the batch-3 checkpoint;
-- applied to prod only on explicit go-ahead, in the batch order.
--
-- Audit HIGH 1 — dismissal re-show fix.
--   A want-in person the creator dismissed, who then RE-RAISES their hand on the
--   SAME plan, never reappears in the composer's INVITE PEOPLE suggestions.
--
-- Root cause (confirmed against live prod):
--   send_interest_signal early-returns when an ACTIVE signal already exists, so
--   its `ON CONFLICT DO UPDATE` (re-activate) fires ONLY for a genuinely
--   re-raised, previously non-active signal — but it advances no timestamp. The
--   gated get_invite_interest_signals hides a suggestion while
--   `dismissed_suggestions.dismissed_at >= event_interest_signals.created_at`.
--   Because a re-raise keeps the old created_at, the dismissal keeps hiding it.
--
-- Fix (smallest blast radius on the LIVE path):
--   * Add a nullable event_interest_signals.reactivated_at.
--   * send_interest_signal stamps reactivated_at = now() on the re-activation
--     branch ONLY (the ON CONFLICT DO UPDATE). We deliberately DO NOT bump
--     created_at: the LIVE get_creator_interest_signals does `ORDER BY created_at
--     DESC`, so mutating created_at would reorder the live "people who want in"
--     list. A new column leaves every live read byte-identical.
--   * The GATED get_invite_interest_signals compares the dismissal against
--     COALESCE(reactivated_at, created_at) and orders by the same expression, so a
--     re-raise resurfaces and bubbles to the top.
--
-- Flag-off safety: the live send_interest_signal gains one extra SET on a branch
-- that only runs for a real re-raise; no live ordering changes. The predicate
-- change is in get_invite_interest_signals, which only the gated composer calls.
-- ===========================================================================
BEGIN;

ALTER TABLE public.event_interest_signals
  ADD COLUMN IF NOT EXISTS reactivated_at timestamptz;

-- --- send_interest_signal: live body, reproduced verbatim, + reactivated_at ----
CREATE OR REPLACE FUNCTION public.send_interest_signal(p_event_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id     uuid := auth.uid();
  v_creator     uuid;
  v_start       timestamptz;
  v_end         timestamptz;
  v_existing    uuid;
  v_signal_id   uuid;
  v_user_name   text;
  v_event_title text;
  v_creator_name text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select creator_user_id, start_time, end_time, title
    into v_creator, v_start, v_end, v_event_title
  from events
  where id = p_event_id;

  if v_creator is null then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;

  if v_creator = v_user_id then
    raise exception 'creators can''t signal interest in their own plan' using errcode = 'P0001';
  end if;

  if _event_is_past(v_start, v_end) then
    raise exception 'this plan has already happened' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from event_members
    where event_id = p_event_id
      and user_id = v_user_id
      and status = 'joined'
  ) then
    raise exception 'you''re already going to this plan' using errcode = 'P0001';
  end if;

  if _users_blocked(v_user_id, v_creator) then
    raise exception 'this plan isn''t available to you' using errcode = 'P0001';
  end if;

  select id into v_existing
  from event_interest_signals
  where event_id = p_event_id
    and interested_user_id = v_user_id
    and status = 'active';
  if v_existing is not null then
    return v_existing;
  end if;

  insert into event_interest_signals (event_id, interested_user_id, creator_id)
  values (p_event_id, v_user_id, v_creator)
  on conflict (event_id, interested_user_id) do update
    set status = 'active',
        skip_count = 0,
        expired_at = null,
        expiry_reason = null,
        consumed_at = null,
        consumed_by_event_id = null,
        reactivated_at = now()          -- re-raise: advance the re-show clock
  returning id into v_signal_id;

  select first_name_display into v_user_name from profiles where id = v_user_id;
  select first_name_display into v_creator_name from profiles where id = v_creator;
  insert into app_notifications (user_id, type, title, body, event_id, actor_user_id)
  values (
    v_creator,
    'interest_signal',
    coalesce(v_user_name, 'Someone') || ' would go next time',
    'They can''t make this one, but want in on the next.',
    p_event_id,
    v_user_id
  );

  return v_signal_id;
end;
$function$;

-- --- get_invite_interest_signals: dismissal predicate now re-raise-aware -------
CREATE OR REPLACE FUNCTION public.get_invite_interest_signals()
 RETURNS TABLE(signal_id uuid, interested_user_id uuid, interested_name text, interested_photo_url text, origin_event_id uuid, origin_event_title text, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    s.id, s.interested_user_id, p.first_name_display, p.profile_photo_url,
    s.event_id, e.title, s.created_at
  FROM public.event_interest_signals s
  JOIN public.profiles p ON p.id = s.interested_user_id
  JOIN public.events   e ON e.id = s.event_id
  WHERE s.creator_id = auth.uid()
    AND s.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.dismissed_suggestions d
      WHERE d.user_id = auth.uid()
        AND d.suggested_user_id = s.interested_user_id
        AND d.dismissed_at >= COALESCE(s.reactivated_at, s.created_at)
    )
  ORDER BY COALESCE(s.reactivated_at, s.created_at) DESC
  LIMIT 50;
$function$;

-- --- in-transaction self-test (rolls back; leaves no trace) ------------------
DO $$
DECLARE
  v_creator uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';   -- Liz (creator)
  v_them    uuid := 'cafe0001-0000-0000-0000-000000000001';   -- Sage (want-in)
  v_event   uuid;
  v_sig     uuid;
  v_created timestamptz;
  v_react   timestamptz;
  v_shown   int;
BEGIN
  BEGIN
    -- A future plan created by Liz.
    INSERT INTO public.events (title, creator_user_id, start_time, end_time, status, gender_rule, min_invites, max_invites, member_count, city)
    VALUES ('reshow-selftest', v_creator, now() + interval '2 days', now() + interval '2 days 3 hours',
            'forming', 'mixed', 1, 8, 1, 'Los Angeles')
    RETURNING id INTO v_event;

    -- Sage raises a hand -> a fresh active signal, reactivated_at NULL.
    -- NOTE: now() is FROZEN per-transaction, so we backdate the original raise and
    -- the dismissal with explicit intervals; only the re-raise lands at "now".
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_them, 'role', 'authenticated')::text, true);
    v_sig := public.send_interest_signal(v_event);
    SELECT reactivated_at INTO v_react
      FROM public.event_interest_signals WHERE id = v_sig;
    IF v_react IS NOT NULL THEN
      RAISE EXCEPTION 'self-test: first raise should leave reactivated_at NULL, got %', v_react;
    END IF;
    -- Backdate the original raise to 2h ago.
    UPDATE public.event_interest_signals SET created_at = now() - interval '2 hours' WHERE id = v_sig;
    SELECT created_at INTO v_created FROM public.event_interest_signals WHERE id = v_sig;

    -- Liz dismisses Sage; backdate the dismissal to 1h ago (after the raise) -> hidden.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
    PERFORM public.dismiss_suggestion(v_them);
    UPDATE public.dismissed_suggestions SET dismissed_at = now() - interval '1 hour'
      WHERE user_id = v_creator AND suggested_user_id = v_them;
    SELECT count(*) INTO v_shown FROM public.get_invite_interest_signals() WHERE signal_id = v_sig;
    IF v_shown <> 0 THEN
      RAISE EXCEPTION 'self-test: dismissed signal should be hidden, but it showed';
    END IF;

    -- The signal goes non-active (it expired/was consumed), then Sage RE-RAISES.
    UPDATE public.event_interest_signals
      SET status = 'expired', expired_at = now(), expiry_reason = 'time_limit'
      WHERE id = v_sig;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_them, 'role', 'authenticated')::text, true);
    PERFORM public.send_interest_signal(v_event);   -- reactivated_at = now() (after the 1h-ago dismissal)
    SELECT reactivated_at INTO v_react FROM public.event_interest_signals WHERE id = v_sig;
    IF v_react IS NULL OR v_react <= v_created THEN
      RAISE EXCEPTION 'self-test: re-raise should set reactivated_at > created_at (created %, react %)', v_created, v_react;
    END IF;

    -- Liz's composer suggestions now RE-SHOW Sage.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_shown FROM public.get_invite_interest_signals() WHERE signal_id = v_sig;
    IF v_shown <> 1 THEN
      RAISE EXCEPTION 'self-test: re-raised signal should re-show, count %', v_shown;
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'interest_signal reshow self-test passed';
END $$;

COMMIT;
