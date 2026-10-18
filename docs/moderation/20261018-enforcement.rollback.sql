-- Emergency rollback. Retains all reports, tasks, audit rows, notifications,
-- membership removals and messages. Reopens the old enforcement gaps; use only
-- to recover from a demonstrated release regression. No automatic rejoining.
BEGIN;
SET LOCAL lock_timeout='5s';
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='report-review-alerts';
DROP TRIGGER IF EXISTS aa_lock_plan_block_changes ON public.profiles;
DROP TRIGGER IF EXISTS aa_lock_plan_block_changes ON public.user_blocks;
DROP TRIGGER IF EXISTS enforce_table_plan_block ON public.user_blocks;
DROP TRIGGER IF EXISTS aa_guard_plan_membership_contact ON public.event_members;
DROP TRIGGER IF EXISTS aa_guard_report_submission ON public.reports;
DROP TRIGGER IF EXISTS enqueue_report_review ON public.reports;
DROP TRIGGER IF EXISTS stamp_report_review ON public.reports;
DROP TRIGGER IF EXISTS queue_no_show_report ON public.no_show_reports;
DROP POLICY IF EXISTS plan_block_message_select ON public.messages;
DROP POLICY IF EXISTS plan_block_message_insert ON public.messages;
DROP POLICY IF EXISTS plan_block_message_update ON public.messages;
CREATE OR REPLACE FUNCTION public.expire_interests_on_block()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_old uuid[] := coalesce(old.blocked_users, '{}'::uuid[]);
  v_new uuid[] := coalesce(new.blocked_users, '{}'::uuid[]);
  v_added uuid[];
begin
  select array_agg(x) into v_added from unnest(v_new) x where not (x = any(v_old));
  if v_added is null or array_length(v_added, 1) is null then
    return new;
  end if;

  -- Expire any active interest signals between the blocker and the newly blocked users
  update public.event_interest_signals
     set status = 'expired',
         expired_at = now(),
         expiry_reason = 'blocked'
   where status = 'active'
     and (
       (interested_user_id = new.id and creator_id = any(v_added))
       or (creator_id = new.id and interested_user_id = any(v_added))
     );

  -- Remove the two people from any UPCOMING plan they now share. Rule:
  --   * remove the BLOCKED user from the shared plan, unless they are the host
  --   * if the blocked user IS the host, remove the BLOCKER instead
  --     (a host is never kicked from their own plan)
  -- Completed/cancelled plans are left intact to preserve history.
  update public.event_members em
     set status = 'removed'
    from public.events e
   where em.event_id = e.id
     and e.status in ('forming','full','draft')
     and em.status = 'joined'
     and em.role <> 'host'
     and (
           -- blocked user is on a plan the blocker is also on -> remove blocked user
           ( em.user_id = any(v_added)
             and exists (select 1 from public.event_members o
                          where o.event_id = em.event_id
                            and o.user_id = new.id
                            and o.status = 'joined') )
           -- blocked user hosts a plan the blocker is on -> remove the blocker
           or ( em.user_id = new.id
             and exists (select 1 from public.event_members o
                          where o.event_id = em.event_id
                            and o.user_id = any(v_added)
                            and o.role = 'host'
                            and o.status = 'joined') )
         );

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.join_event_atomic(p_event_id uuid, p_user_id uuid, p_age_at_join integer DEFAULT NULL::integer, p_gender_at_join text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event RECORD;
  v_member_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'can only join as yourself';
  END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;

  IF v_event IS NULL THEN
    RETURN 'not_found';
  END IF;

  IF v_event.status = 'full' THEN
    RETURN 'full';
  END IF;

  SELECT count(*)::int INTO v_member_count
  FROM event_members
  WHERE event_id = p_event_id AND status = 'joined';

  IF v_member_count > COALESCE(v_event.max_invites, 7) THEN
    UPDATE events SET status = 'full' WHERE id = p_event_id;
    RETURN 'full';
  END IF;

  IF EXISTS (
    SELECT 1 FROM app_notifications
    WHERE event_id = p_event_id
      AND type = 'waitlist_spot'
      AND status = 'unread'
      AND expires_at > now()
      AND user_id <> p_user_id
  ) AND NOT EXISTS (
    SELECT 1 FROM app_notifications
    WHERE event_id = p_event_id
      AND type = 'waitlist_spot'
      AND status = 'unread'
      AND expires_at > now()
      AND user_id = p_user_id
  ) THEN
    RETURN 'waitlist_priority';
  END IF;

  UPDATE event_members
  SET status = 'joined', role = 'guest',
      age_at_join = COALESCE(p_age_at_join, age_at_join),
      gender_at_join = COALESCE(p_gender_at_join, gender_at_join)
  WHERE event_id = p_event_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO event_members (event_id, user_id, role, status, age_at_join, gender_at_join)
    VALUES (p_event_id, p_user_id, 'guest', 'joined', p_age_at_join, p_gender_at_join);
  END IF;

  IF (v_member_count + 1) > COALESCE(v_event.max_invites, 7) THEN
    UPDATE events SET status = 'full' WHERE id = p_event_id;
  END IF;

  RETURN 'joined';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.join_circle_plan_atomic(p_event_id uuid, p_user_id uuid, p_age_at_join integer DEFAULT NULL::integer, p_gender_at_join text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_event      RECORD;
  v_is_member  boolean;
  v_strangers  integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'can only join as yourself';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event IS NULL THEN
    RETURN 'not_found';
  END IF;
  IF v_event.circle_id IS NULL THEN
    RETURN 'not_circle_plan';
  END IF;

  v_is_member := public.is_circle_member(v_event.circle_id, p_user_id);

  IF NOT v_is_member AND v_event.circle_visibility = 'circle_only' THEN
    RETURN 'not_eligible';
  END IF;

  IF NOT v_is_member THEN
    SELECT count(*)::int INTO v_strangers
    FROM public.event_members em
    WHERE em.event_id = p_event_id
      AND em.status = 'joined'
      AND NOT public.is_circle_member(v_event.circle_id, em.user_id);

    IF v_strangers >= COALESCE(v_event.stranger_cap, 0) THEN
      RETURN 'full';
    END IF;
  END IF;

  UPDATE public.event_members
  SET status = 'joined',
      role = CASE WHEN role = 'host' THEN 'host'::member_role ELSE 'guest'::member_role END,
      age_at_join    = COALESCE(p_age_at_join, age_at_join),
      gender_at_join = COALESCE(p_gender_at_join, gender_at_join)
  WHERE event_id = p_event_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO public.event_members (event_id, user_id, role, status, age_at_join, gender_at_join)
    VALUES (p_event_id, p_user_id, 'guest', 'joined', p_age_at_join, p_gender_at_join);
  END IF;

  RETURN 'joined';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.edit_own_chat_message(p_message_id uuid, p_kind text, p_conversation_id uuid, p_expected_content text, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_message public.messages%ROWTYPE;
  v_event public.events%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  -- Preserve the production account hold for the newly introduced UPDATE path.
  -- A shared profile lock serializes the permission check with moderation changes.
  PERFORM 1 FROM public.profiles WHERE id = v_uid
    AND (suspended_until IS NULL OR suspended_until <= statement_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF p_message_id IS NULL OR p_conversation_id IS NULL OR p_kind IS NULL
     OR p_kind NOT IN ('event','circle') OR p_expected_content IS NULL
     OR p_content IS NULL OR length(btrim(p_content)) = 0 OR length(p_content) > 1000 THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  IF p_kind = 'event' THEN
    SELECT * INTO v_event FROM public.events WHERE id = p_conversation_id FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
    PERFORM 1 FROM public.event_members WHERE event_id = p_conversation_id
      AND user_id = v_uid AND status = 'joined' FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
    -- Same end-first 48-hour writing window as the native Plan chat.
    -- This does not install or change the separately held archive job.
    IF v_event.status::text = 'cancelled' OR statement_timestamp() >=
      (CASE WHEN v_event.end_time > v_event.start_time THEN v_event.end_time ELSE v_event.start_time END) + interval '48 hours' THEN
      RETURN jsonb_build_object('status','closed');
    END IF;
  ELSE
    IF public.private_chat_contact_allowed(p_conversation_id) IS NOT TRUE THEN
      RETURN jsonb_build_object('status','unavailable');
    END IF;
    PERFORM 1 FROM public.circle_members WHERE circle_id = p_conversation_id
      AND user_id = v_uid AND status = 'joined' FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  END IF;
  SELECT * INTO v_message FROM public.messages
    WHERE id = p_message_id AND user_id = v_uid
      AND ((p_kind = 'event' AND event_id = p_conversation_id AND circle_id IS NULL)
        OR (p_kind = 'circle' AND circle_id = p_conversation_id AND event_id IS NULL))
    FOR UPDATE;
  IF NOT FOUND OR v_message.message_type::text IS DISTINCT FROM 'user'
      OR v_message.image_url IS NOT NULL OR v_message.audio_url IS NOT NULL THEN
    RETURN jsonb_build_object('status','unavailable');
  END IF;
  IF v_message.content = p_content THEN
    RETURN jsonb_build_object('status','saved','id',v_message.id,'content',v_message.content);
  END IF;
  IF v_message.content IS DISTINCT FROM p_expected_content THEN
    RETURN jsonb_build_object('status','changed');
  END IF;
  UPDATE public.messages SET content = p_content WHERE id = v_message.id;
  RETURN jsonb_build_object('status','saved','id',v_message.id,'content',p_content);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.edit_own_chat_message_with_mentions(p_message_id uuid, p_kind text, p_conversation_id uuid, p_expected_content text, p_content text, p_expected_mentions jsonb, p_mentions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_message public.messages%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_mentions jsonb;
  v_expected_mentions jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  -- Preserve the production account hold for the newly introduced UPDATE path.
  -- A shared profile lock serializes the permission check with moderation changes.
  PERFORM 1 FROM public.profiles WHERE id = v_uid
    AND (suspended_until IS NULL OR suspended_until <= statement_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF p_message_id IS NULL OR p_conversation_id IS NULL OR p_kind IS NULL
     OR p_kind NOT IN ('event','circle') OR p_expected_content IS NULL
     OR p_content IS NULL OR length(btrim(p_content)) = 0 OR length(p_content) > 1000 THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  IF p_kind = 'event' THEN
    SELECT * INTO v_event FROM public.events WHERE id = p_conversation_id FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
    PERFORM 1 FROM public.event_members WHERE event_id = p_conversation_id
      AND user_id = v_uid AND status = 'joined' FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
    -- Same end-first 48-hour writing window as the native Plan chat.
    -- This does not install or change the separately held archive job.
    IF v_event.status::text = 'cancelled' OR statement_timestamp() >=
      (CASE WHEN v_event.end_time > v_event.start_time THEN v_event.end_time ELSE v_event.start_time END) + interval '48 hours' THEN
      RETURN jsonb_build_object('status','closed');
    END IF;
  ELSE
    IF public.private_chat_contact_allowed(p_conversation_id) IS NOT TRUE THEN
      RETURN jsonb_build_object('status','unavailable');
    END IF;
    PERFORM 1 FROM public.circle_members WHERE circle_id = p_conversation_id
      AND user_id = v_uid AND status = 'joined' FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  END IF;
  SELECT * INTO v_message FROM public.messages
    WHERE id = p_message_id AND user_id = v_uid
      AND ((p_kind = 'event' AND event_id = p_conversation_id AND circle_id IS NULL)
        OR (p_kind = 'circle' AND circle_id = p_conversation_id AND event_id IS NULL))
    FOR UPDATE;
  IF NOT FOUND OR v_message.message_type::text IS DISTINCT FROM 'user'
      OR v_message.image_url IS NOT NULL OR v_message.audio_url IS NOT NULL THEN
    RETURN jsonb_build_object('status','unavailable');
  END IF;
  v_mentions := public.validate_chat_mention_document(p_content,p_mentions);
  v_expected_mentions := public.validate_chat_mention_document(p_expected_content,p_expected_mentions);
  IF v_message.content = p_content
    AND coalesce(v_message.mention_data->'references','[]'::jsonb) = coalesce(v_mentions->'references','[]'::jsonb) THEN
    RETURN jsonb_build_object('status','saved','id',v_message.id,'content',v_message.content,'mention_data',v_message.mention_data);
  END IF;
  IF v_message.content IS DISTINCT FROM p_expected_content
    OR coalesce(v_message.mention_data->'references','[]'::jsonb) IS DISTINCT FROM coalesce(v_expected_mentions->'references','[]'::jsonb) THEN
    RETURN jsonb_build_object('status','changed');
  END IF;
  UPDATE public.messages SET content = p_content, mention_data = v_mentions WHERE id = v_message.id;
  RETURN jsonb_build_object('status','saved','id',v_message.id,'content',p_content,'mention_data',v_mentions);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.report_no_show(p_event_id uuid, p_no_show_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF v_me = p_no_show_user_id THEN RAISE EXCEPTION 'cannot_report_self'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_members em
                 WHERE em.event_id=p_event_id AND em.user_id=v_me) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_members em
                 WHERE em.event_id=p_event_id AND em.user_id=p_no_show_user_id) THEN
    RAISE EXCEPTION 'target_not_a_member';
  END IF;
  INSERT INTO public.no_show_reports (event_id, reporter_user_id, no_show_user_id)
  SELECT p_event_id, v_me, p_no_show_user_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.no_show_reports r
    WHERE r.event_id=p_event_id AND r.reporter_user_id=v_me
      AND r.no_show_user_id=p_no_show_user_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.auto_ban_reported_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  report_count    integer;
  v_rows          integer;
  v_email         text;
  v_phone         text;
  v_apple_sub     text;
  v_profile_email text;
BEGIN
  SELECT COUNT(*) INTO report_count
  FROM reports
  WHERE reported_user_id = NEW.reported_user_id
    AND reason IS DISTINCT FROM 'Blocked by user';

  IF report_count >= 3 THEN
    UPDATE auth.users
    SET banned_until = '2099-01-01 00:00:00+00'
    WHERE id = NEW.reported_user_id
      AND (banned_until IS NULL OR banned_until < NOW());

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    -- v_rows > 0 only the first time this user crosses the threshold -- every
    -- later report re-fires this trigger and re-evaluates report_count >= 3,
    -- but the WHERE guard above makes the UPDATE a no-op from then on, so
    -- everything below only runs once per user, same as before this change.
    IF v_rows > 0 THEN
      -- banned_until alone only blocks token refresh; it doesn't end a
      -- session that's already live. Mirrors admin_ban_user()'s session-kill.
      DELETE FROM auth.refresh_tokens WHERE user_id = NEW.reported_user_id::text;
      DELETE FROM auth.sessions       WHERE user_id = NEW.reported_user_id;

      SELECT u.email, u.phone::text, u.raw_user_meta_data->>'sub'
        INTO v_email, v_phone, v_apple_sub
      FROM auth.users u WHERE u.id = NEW.reported_user_id;

      -- Phone-auth users have no auth.users.email; mirrors admin_ban_user()'s
      -- profile-email fallback.
      SELECT p.email INTO v_profile_email
      FROM profiles p WHERE p.id = NEW.reported_user_id;
      v_email := COALESCE(v_email, v_profile_email);

      IF v_email IS NOT NULL OR v_apple_sub IS NOT NULL OR v_phone IS NOT NULL THEN
        INSERT INTO banned_identifiers
          (email, apple_sub, phone_number, reason, banned_by, banned_at)
        VALUES
          (v_email, v_apple_sub, v_phone, 'Automated report threshold reached', NULL, now());
      END IF;

      INSERT INTO moderation_actions
        (action, target_user_id, target_email, target_apple_sub, reason, performed_by, metadata)
      VALUES
        ('auto_ban', NEW.reported_user_id, v_email, v_apple_sub,
         'Automated report threshold reached', NULL,
         jsonb_build_object('report_count', report_count));
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.moderation_automation_failures
    (operation, target_user_id, error_code, error_message)
  VALUES
    ('auto_ban_reported_user', NEW.reported_user_id, SQLSTATE, left(SQLERRM, 500));
  RETURN NEW;
END;
$function$
;
NOTIFY pgrst,'reload schema';
COMMIT;
