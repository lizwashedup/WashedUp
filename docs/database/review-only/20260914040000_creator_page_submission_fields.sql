-- Local review-only follow-up: brief private creator information.
-- No legacy account application RPC, ownership, membership or event identity is replaced.
BEGIN;
CREATE OR REPLACE FUNCTION public.submit_creator_page(
  p_page_id uuid, p_submission_id uuid, p_expected_version integer,
  p_application jsonb, p_accept_terms boolean
) RETURNS public.creator_page_submissions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_page public.creator_page_drafts; v_submission public.creator_page_submissions;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_page FROM public.creator_page_drafts WHERE id = p_page_id FOR UPDATE;
  IF v_page.id IS NULL OR v_page.owner_id <> v_uid THEN
    RAISE EXCEPTION 'Page unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_submission_id IS NULL OR p_expected_version IS NULL OR p_accept_terms IS DISTINCT FROM true
     OR p_application IS NULL OR jsonb_typeof(p_application) <> 'object' OR p_application = '{}'::jsonb THEN
    RAISE EXCEPTION 'Application and accepted terms are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_submission FROM public.creator_page_submissions WHERE id = p_submission_id;
  IF v_submission.id IS NOT NULL THEN
    IF v_submission.page_id = p_page_id AND v_submission.draft_version = p_expected_version
       AND v_submission.application = p_application THEN RETURN v_submission; END IF;
    RAISE EXCEPTION 'Submission does not match the original attempt' USING ERRCODE = '22023';
  END IF;
  -- The agreed brief creator information is private and required on new submissions.
  -- Exact retries above still preserve already received historical submissions.
  IF jsonb_typeof(p_application->'your_name') IS DISTINCT FROM 'string'
     OR length(btrim(p_application->>'your_name')) NOT BETWEEN 1 AND 80
     OR jsonb_typeof(p_application->'contact_email') IS DISTINCT FROM 'string'
     OR length(btrim(p_application->>'contact_email')) > 254
     OR btrim(p_application->>'contact_email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR jsonb_typeof(p_application->'why_you') IS DISTINCT FROM 'string'
     OR length(btrim(p_application->>'why_you')) NOT BETWEEN 1 AND 300
     OR p_application->'creator_guidelines' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'Complete your name, contact email, creator introduction and guidelines agreement' USING ERRCODE='22023';
  END IF;
  IF v_page.version <> p_expected_version THEN
    RAISE EXCEPTION 'Page changed. Reload before submitting.' USING ERRCODE = 'PT409';
  END IF;
  -- Preserve the existing page field limits.
  IF jsonb_typeof(v_page.page_data->'name') IS DISTINCT FROM 'string'
     OR length(btrim(v_page.page_data->>'name')) NOT BETWEEN 2 AND 60
     OR jsonb_typeof(v_page.page_data->'purpose') IS DISTINCT FROM 'string'
     OR length(btrim(v_page.page_data->>'purpose')) NOT BETWEEN 10 AND 140
     OR jsonb_typeof(v_page.page_data->'city') IS DISTINCT FROM 'string'
     OR length(btrim(v_page.page_data->>'city')) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'Complete the page name, purpose and city' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.creator_page_submissions WHERE page_id = p_page_id AND status = 'submitted') THEN
    RAISE EXCEPTION 'This page already has a pending review' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.creator_page_submissions
    (id, page_id, revision, draft_version, page_snapshot, application, terms_accepted_at)
  VALUES (p_submission_id, p_page_id,
    (SELECT coalesce(max(revision), 0) + 1 FROM public.creator_page_submissions WHERE page_id = p_page_id),
    v_page.version, v_page.page_data, p_application, now())
  RETURNING * INTO v_submission;
  RETURN v_submission;
END;
$$;

COMMIT;
