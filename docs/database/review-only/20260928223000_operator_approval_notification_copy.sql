-- REVIEW ONLY. Approval notification wording; no review/action invocation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.admin_review_operator_grant(uuid,public.operator_grant_status,text,text)'::regprocedure)) <> 'a8be1cd085ed8909f7ed4130a9e9a94c' THEN RAISE EXCEPTION 'Review function drift';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.admin_review_operator_grant(p_grant_id uuid, p_outcome operator_grant_status, p_notes text DEFAULT NULL::text, p_applicant_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid;
  v_track public.operator_track;
  v_title text;
  v_body text;
begin
  if not (is_admin(auth.uid()) or has_role(auth.uid(), 'admin'::app_role)) then
    raise exception 'Not authorized';
  end if;
  if p_outcome not in ('in_review', 'needs_more_info', 'approved', 'declined', 'revoked') then
    raise exception 'Invalid review outcome';
  end if;

  update operator_grants
  set status = p_outcome,
      applicant_message = p_applicant_message,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_grant_id
  returning user_id, track into v_user, v_track;

  if v_user is null then
    raise exception 'Application not found';
  end if;

  if p_notes is not null and btrim(p_notes) <> '' then
    insert into operator_grant_review_notes (grant_id, notes, created_by)
    values (p_grant_id, btrim(p_notes), auth.uid());
  end if;

  -- LIZ COPY (stubs, unchanged from phase 2)
  if p_outcome = 'approved' then
    v_title := case v_track
      when 'community_leader' then 'Your community application was approved'
      when 'event_host' then 'Your organization application was approved'
      else 'Your creator application was approved' end;
    v_body := coalesce(p_applicant_message || ' ', '')
      || 'Open your application status to set up your '
      || case v_track when 'community_leader' then 'community' when 'event_host' then 'organization' else 'Creator space' end || '.';
  elsif p_outcome = 'needs_more_info' then
    v_title := 'one thing before we say yes';
    v_body := coalesce(p_applicant_message || ' ', '') || 'update your application and send it back in.';
  elsif p_outcome = 'declined' then
    v_title := 'about your application';
    v_body := coalesce(p_applicant_message || ' ', '') || 'not the right fit right now, and the door stays open. you can apply again anytime.';
  end if;

  if v_title is not null then
    insert into app_notifications (user_id, type, title, body)
    values (v_user, 'operator_grant', v_title, v_body);
  end if;
end;
$function$;
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.admin_review_operator_grant(uuid,public.operator_grant_status,text,text)'::regprocedure)) <> '487f3a23d67ff1085e0e325eacf55e95' THEN RAISE EXCEPTION 'Review function drift';END IF;END $guard$;
ROLLBACK;
