-- LOCAL / REVIEW ONLY. D12-D13 first increment: private page drafts and review.
-- No legacy grant migration, public visibility, membership or event changes.
-- Publication must be implemented separately against the exact approved snapshot.
BEGIN;

CREATE TABLE public.creator_page_drafts (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_kind text NOT NULL CHECK (page_kind IN ('community', 'organization')),
  page_data jsonb NOT NULL CHECK (jsonb_typeof(page_data) = 'object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.creator_page_submissions (
  id uuid PRIMARY KEY,
  page_id uuid NOT NULL REFERENCES public.creator_page_drafts(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  draft_version integer NOT NULL CHECK (draft_version > 0),
  page_snapshot jsonb NOT NULL CHECK (jsonb_typeof(page_snapshot) = 'object'),
  application jsonb NOT NULL CHECK (jsonb_typeof(application) = 'object' AND application <> '{}'::jsonb),
  terms_accepted_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'needs_more_info', 'declined')),
  applicant_message text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, revision),
  CHECK ((status = 'submitted' AND reviewed_by IS NULL AND reviewed_at IS NULL AND applicant_message IS NULL)
    OR (status <> 'submitted' AND reviewed_at IS NOT NULL)),
  CHECK (status NOT IN ('needs_more_info', 'declined') OR length(btrim(applicant_message)) > 0)
);
CREATE UNIQUE INDEX creator_page_one_pending_submission
  ON public.creator_page_submissions(page_id) WHERE status = 'submitted';
CREATE INDEX creator_page_drafts_owner ON public.creator_page_drafts(owner_id);

-- Clear inherited platform defaults explicitly, including truncate/references/trigger.
REVOKE ALL ON public.creator_page_drafts, public.creator_page_submissions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.creator_page_drafts, public.creator_page_submissions TO authenticated;
ALTER TABLE public.creator_page_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_page_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY creator_page_drafts_read ON public.creator_page_drafts FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid())));
CREATE POLICY creator_page_submissions_read ON public.creator_page_submissions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.creator_page_drafts p
    WHERE p.id = page_id AND (p.owner_id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid())))));

CREATE FUNCTION public.save_creator_page_draft(
  p_page_id uuid, p_page_kind text, p_page_data jsonb, p_expected_version integer
) RETURNS public.creator_page_drafts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_page public.creator_page_drafts;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_page_id IS NULL OR p_page_kind IS NULL OR p_page_kind NOT IN ('community', 'organization')
     OR p_expected_version IS NULL OR p_expected_version < 0
     OR p_page_data IS NULL OR jsonb_typeof(p_page_data) <> 'object' THEN
    RAISE EXCEPTION 'Invalid page draft' USING ERRCODE = '22023';
  END IF;
  IF p_expected_version = 0 THEN
    INSERT INTO public.creator_page_drafts (id, owner_id, page_kind, page_data)
    VALUES (p_page_id, v_uid, p_page_kind, p_page_data) ON CONFLICT (id) DO NOTHING;
  END IF;
  SELECT * INTO v_page FROM public.creator_page_drafts WHERE id = p_page_id FOR UPDATE;
  IF v_page.id IS NULL OR v_page.owner_id <> v_uid THEN
    RAISE EXCEPTION 'Page unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_page.page_kind <> p_page_kind THEN
    RAISE EXCEPTION 'Page type cannot change' USING ERRCODE = '22023';
  END IF;
  -- Exact retry is safe after a lost response; no second row/version is created.
  IF v_page.version = p_expected_version + 1 AND v_page.page_data = p_page_data THEN RETURN v_page; END IF;
  IF v_page.version <> p_expected_version THEN
    RAISE EXCEPTION 'Page changed. Reload before saving.' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.creator_page_drafts SET page_data = p_page_data, version = version + 1, updated_at = now()
    WHERE id = p_page_id RETURNING * INTO v_page;
  RETURN v_page;
END;
$$;

CREATE FUNCTION public.submit_creator_page(
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
  IF v_page.version <> p_expected_version THEN
    RAISE EXCEPTION 'Page changed. Reload before submitting.' USING ERRCODE = 'PT409';
  END IF;
  -- Minimal existing page fields; detailed track answers reuse existing form validation.
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

CREATE FUNCTION public.review_creator_page(
  p_page_id uuid, p_submission_id uuid, p_decision text, p_applicant_message text DEFAULT NULL
) RETURNS public.creator_page_submissions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_submission public.creator_page_submissions;
  v_message text := nullif(btrim(p_applicant_message), '');
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Not authorized to review pages' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'needs_more_info', 'declined')
     OR (p_decision IN ('needs_more_info', 'declined') AND v_message IS NULL) THEN
    RAISE EXCEPTION 'A decision and any required feedback are needed' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_submission FROM public.creator_page_submissions
    WHERE id = p_submission_id AND page_id = p_page_id FOR UPDATE;
  IF v_submission.id IS NULL THEN RAISE EXCEPTION 'Submission unavailable' USING ERRCODE = '42501'; END IF;
  IF v_submission.status <> 'submitted' THEN
    IF v_submission.status = p_decision AND v_submission.applicant_message IS NOT DISTINCT FROM v_message
       AND v_submission.reviewed_by = v_uid THEN RETURN v_submission; END IF;
    RAISE EXCEPTION 'This submission already has a decision' USING ERRCODE = '22023';
  END IF;
  UPDATE public.creator_page_submissions SET status = p_decision, applicant_message = v_message,
    reviewed_by = v_uid, reviewed_at = now() WHERE id = p_submission_id RETURNING * INTO v_submission;
  -- Deliberately no community, event, membership, publication or operator-grant write.
  RETURN v_submission;
END;
$$;

REVOKE ALL ON FUNCTION public.save_creator_page_draft(uuid,text,jsonb,integer),
  public.submit_creator_page(uuid,uuid,integer,jsonb,boolean),
  public.review_creator_page(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_creator_page_draft(uuid,text,jsonb,integer),
  public.submit_creator_page(uuid,uuid,integer,jsonb,boolean),
  public.review_creator_page(uuid,uuid,text,text) TO authenticated;

COMMIT;
