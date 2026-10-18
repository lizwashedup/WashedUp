-- Durable review ownership and escalation. Alerts are not review decisions.
-- Existing historical no_show_reports are deliberately not replayed through
-- the automatic-ban trigger. They require a separate human backlog review.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.report_review_tasks (
  report_id uuid PRIMARY KEY REFERENCES public.reports(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notification_id uuid REFERENCES public.app_notifications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_error text
);
ALTER TABLE public.report_review_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_review_tasks FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.report_review_tasks TO authenticated;
GRANT ALL ON public.report_review_tasks TO service_role;
CREATE POLICY administrators_read_review_tasks ON public.report_review_tasks FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=auth.uid()));

CREATE TABLE public.report_review_alert_state (
  alert_key text PRIMARY KEY,
  last_sent_at timestamptz,
  notification_id uuid REFERENCES public.app_notifications(id) ON DELETE SET NULL
);
ALTER TABLE public.report_review_alert_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_review_alert_state FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.report_review_alert_state TO service_role;

CREATE FUNCTION public.guard_report_submission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- A reporter cannot submit a pre-reviewed case or forge an administrator.
  IF NEW.reason='No-show to plan' AND (
    NEW.reported_user_id IS NULL OR NEW.reported_user_id=NEW.reporter_user_id
    OR NOT EXISTS(SELECT 1 FROM public.events WHERE id=NEW.reported_event_id
      AND start_time<=now() AND status<>'cancelled')
    OR NOT EXISTS(SELECT 1 FROM public.event_members WHERE event_id=NEW.reported_event_id AND user_id=NEW.reporter_user_id)
    OR NOT EXISTS(SELECT 1 FROM public.event_members WHERE event_id=NEW.reported_event_id AND user_id=NEW.reported_user_id)
  ) THEN
    RAISE EXCEPTION 'No-show reports require a started plan and its participants' USING ERRCODE='42501';
  END IF;
  NEW.status:='pending';
  NEW.admin_notes:=NULL;
  NEW.reviewed_at:=NULL;
  NEW.reviewed_by_admin_id:=NULL;
  NEW.created_at:=now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_report_submission() FROM PUBLIC,anon,authenticated;
-- Runs before the existing block-generated-report classifier.
CREATE TRIGGER aa_guard_report_submission BEFORE INSERT ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.guard_report_submission();

CREATE FUNCTION public.enqueue_report_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.reason IS DISTINCT FROM 'Blocked by user' AND NEW.status='pending' THEN
    INSERT INTO public.report_review_tasks(report_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_report_review() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER enqueue_report_review AFTER INSERT OR UPDATE OF status ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.enqueue_report_review();

CREATE FUNCTION public.stamp_report_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status='pending' THEN
      NEW.reviewed_at:=NULL;
      NEW.reviewed_by_admin_id:=NULL;
    ELSE
      IF length(btrim(coalesce(NEW.admin_notes,'')))=0 THEN
        RAISE EXCEPTION 'A review note is required';
      END IF;
      NEW.reviewed_at:=now();
      NEW.reviewed_by_admin_id:=auth.uid();
    END IF;
    INSERT INTO public.moderation_actions(action,target_user_id,reason,performed_by,metadata)
    VALUES('report_review',NEW.reported_user_id,coalesce(NEW.admin_notes,'Report reopened'),auth.uid(),
      jsonb_build_object('report_id',NEW.id,'previous_status',OLD.status,'status',NEW.status));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stamp_report_review() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER stamp_report_review BEFORE UPDATE OF status ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.stamp_report_review();

CREATE FUNCTION public.admin_review_report(p_report_id uuid,p_status public.report_status,
  p_notes text,p_expected_status public.report_status) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  IF p_status IS NULL OR p_expected_status IS NULL OR length(btrim(coalesce(p_notes,'')))=0 THEN
    RAISE EXCEPTION 'Status, expected status and a review note are required';
  END IF;
  UPDATE public.reports SET status=p_status,admin_notes=concat_ws(E'\n',nullif(admin_notes,''),btrim(p_notes))
  WHERE id=p_report_id AND status=p_expected_status
  RETURNING jsonb_build_object('id',id,'status',status,'reviewed_at',reviewed_at) INTO v_result;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Report missing or changed; refresh before reviewing'; END IF;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.admin_review_report(uuid,public.report_status,text,public.report_status) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_review_report(uuid,public.report_status,text,public.report_status) TO authenticated;

CREATE FUNCTION public.admin_get_report_review_queue(p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT r.*,q.assigned_to,q.notification_id,q.last_error,
      (r.created_at<now()-interval '24 hours') AS overdue
    FROM public.reports r LEFT JOIN public.report_review_tasks q ON q.report_id=r.id
    WHERE r.status='pending' AND r.reason IS DISTINCT FROM 'Blocked by user'
    ORDER BY r.created_at ASC,r.id LIMIT greatest(1,least(coalesce(p_limit,100),500))
  ) x),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.admin_get_report_review_queue(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_get_report_review_queue(integer) TO authenticated;

CREATE FUNCTION public.dispatch_report_review_alerts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_recipient uuid; item record; v_id uuid; v_count integer:=0; v_overdue integer;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(731018,2) THEN RETURN 0; END IF;
  v_recipient:=public.get_admin_alert_recipient_id();
  IF v_recipient IS NULL OR NOT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=v_recipient) THEN
    UPDATE public.report_review_tasks SET last_error='Configured review recipient missing or not an administrator'
    WHERE report_id IN(SELECT id FROM public.reports WHERE status='pending');
    RETURN 0;
  END IF;
  UPDATE public.report_review_tasks SET assigned_to=v_recipient,last_error=NULL
  WHERE report_id IN(SELECT id FROM public.reports WHERE status='pending');
  FOR item IN SELECT q.report_id FROM public.report_review_tasks q JOIN public.reports r ON r.id=q.report_id
    WHERE r.status='pending' AND q.notification_id IS NULL AND r.created_at>=now()-interval '24 hours'
    ORDER BY r.created_at,q.report_id LIMIT 100
  LOOP
    INSERT INTO public.app_notifications(user_id,type,title,body)
    VALUES(v_recipient,'admin_alert','A member report needs review',
      'A report is awaiting an administrator review and recorded decision. Report ID: '||item.report_id::text)
    RETURNING id INTO v_id;
    UPDATE public.report_review_tasks SET notification_id=v_id WHERE report_id=item.report_id;
    v_count:=v_count+1;
  END LOOP;
  SELECT count(*) INTO v_overdue FROM public.reports
  WHERE status='pending' AND reason IS DISTINCT FROM 'Blocked by user'
    AND created_at<now()-interval '24 hours';
  INSERT INTO public.report_review_alert_state(alert_key) VALUES('overdue') ON CONFLICT DO NOTHING;
  IF v_overdue>0 AND EXISTS(SELECT 1 FROM public.report_review_alert_state
    WHERE alert_key='overdue' AND (last_sent_at IS NULL OR last_sent_at<now()-interval '24 hours')) THEN
    INSERT INTO public.app_notifications(user_id,type,title,body)
    VALUES(v_recipient,'admin_alert','Member reports are overdue',
      v_overdue::text||' reports have waited more than 24 hours for review. Review the pending cases and record a decision for each one.')
    RETURNING id INTO v_id;
    UPDATE public.report_review_alert_state SET last_sent_at=now(),notification_id=v_id WHERE alert_key='overdue';
    v_count:=v_count+1;
  END IF;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_report_review_alerts() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_report_review_alerts() TO service_role;

-- Connect future no-show submissions to the same queue without duplicating a
-- report already submitted through the general Report dialog.
CREATE FUNCTION public.queue_no_show_report() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(731018,3);
  IF NOT EXISTS(SELECT 1 FROM public.reports WHERE reporter_user_id=NEW.reporter_user_id
    AND reported_user_id=NEW.no_show_user_id AND reported_event_id=NEW.event_id AND reason='No-show to plan') THEN
    INSERT INTO public.reports(reporter_user_id,reported_user_id,reported_event_id,reason,details)
    VALUES(NEW.reporter_user_id,NEW.no_show_user_id,NEW.event_id,'No-show to plan','Submitted through plan attendance feedback');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.queue_no_show_report() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER queue_no_show_report AFTER INSERT ON public.no_show_reports
FOR EACH ROW EXECUTE FUNCTION public.queue_no_show_report();

-- Keep the threshold at three, counting independent reporters. One reporter retrying
-- or a dismissed allegation must not supply three independent complaints.
DO $guard$
DECLARE source text;
BEGIN
  source:=pg_get_functiondef('public.report_no_show(uuid,uuid)'::regprocedure);
  IF md5(source)<>'ce844f6ce651382f537f47e5d1ab7d04' THEN
    RAISE EXCEPTION 'No-show reporting source changed since review';
  END IF;
  source:=replace(source,'AND r.no_show_user_id=p_no_show_user_id);',
    E'AND r.no_show_user_id=p_no_show_user_id)\n  ON CONFLICT (event_id,reporter_user_id,no_show_user_id) DO NOTHING;');
  EXECUTE source;
  source:=pg_get_functiondef('public.auto_ban_reported_user()'::regprocedure);
  IF md5(source)<>'7d7b491a549108446f6bd9b27e5879e8' THEN
    RAISE EXCEPTION 'Automatic report moderation source changed since review';
  END IF;
  source:=replace(source,'SELECT COUNT(*) INTO report_count','SELECT COUNT(DISTINCT reporter_user_id) INTO report_count');
  source:=replace(source,E'AND reason IS DISTINCT FROM ''Blocked by user'';',
    E'AND reason IS DISTINCT FROM ''Blocked by user''\n    AND status <> ''dismissed'';');
  EXECUTE source;
END $guard$;

INSERT INTO public.report_review_tasks(report_id)
SELECT id FROM public.reports WHERE status='pending' AND reason IS DISTINCT FROM 'Blocked by user'
ON CONFLICT DO NOTHING;
-- pg_cron is already installed in production. Schedule only this bounded
-- internal dispatcher; no account decisions or bans are made by this job.
SELECT cron.schedule('report-review-alerts','* * * * *','SELECT public.dispatch_report_review_alerts();');
NOTIFY pgrst, 'reload schema';
COMMIT;
