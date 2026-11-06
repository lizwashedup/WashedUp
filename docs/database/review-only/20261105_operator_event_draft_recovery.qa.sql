-- REVIEW ONLY. Run only after specific production approval and deployment.
-- All test writes, including the QA community activation, are rolled back.
-- This exercises database roles/functions, not HTTP transport or a real JWT.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';
CREATE TEMP TABLE draft_recovery_qa ON COMMIT DROP AS
SELECT c.id AS community_id, m.user_id AS actor,
       gen_random_uuid() AS save_request, gen_random_uuid() AS cancel_request,
       NULL::jsonb AS receipt,
       (SELECT count(*) FROM public.community_topics t WHERE t.community_id = c.id) AS topic_count,
       jsonb_build_object(
         'title', 'WashedUp isolated draft recovery QA', 'description', 'Transaction-only QA. Never published.',
         'image_url', '', 'event_date', '', 'start_time', NULL, 'end_time', NULL,
         'venue', '', 'venue_address', '', 'category', 'community', 'categories', jsonb_build_array('community'),
         'external_url', '', 'ticket_price', '', 'public_name', '', 'pin_to_chat', false,
         'description_blocks', jsonb_build_array(), 'confirmation_message', ''
       ) AS fields
FROM public.communities c
JOIN public.community_members m ON m.community_id = c.id AND m.status = 'active' AND m.role = 'leader'
WHERE c.id = 'ed31b9f3-2b78-4690-88b2-c05b74265a11'
  AND c.name = 'WashedUp Discovery QA'
  AND c.purpose = 'Private isolated QA of discovery controls. No ordinary members or invitations.'
  AND c.status = 'archived' AND c.discoverable = false
  AND EXISTS (SELECT 1 FROM public.operator_grants g WHERE g.user_id = m.user_id
              AND g.status = 'approved' AND g.track IN ('community_leader', 'event_host'))
  AND (SELECT count(*) FROM public.community_members cm WHERE cm.community_id = c.id AND cm.status = 'active') = 1;
DO $guard$
BEGIN
  IF (SELECT count(*) FROM pg_temp.draft_recovery_qa) <> 1 THEN
    RAISE EXCEPTION 'The isolated QA community or existing creator authority changed';
  END IF;
END $guard$;
-- No grants, membership, discovery or joining settings are changed.
UPDATE public.communities SET status = 'active'
WHERE id = (SELECT community_id FROM pg_temp.draft_recovery_qa);
GRANT SELECT, UPDATE ON pg_temp.draft_recovery_qa TO authenticated;
SELECT set_config('request.jwt.claim.sub', actor::text, true) FROM pg_temp.draft_recovery_qa;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
DO $qa$
DECLARE c record; saved jsonb; input jsonb; stopped jsonb;
BEGIN
  SELECT * INTO STRICT c FROM pg_temp.draft_recovery_qa;
  input := jsonb_build_object('fields', c.fields, 'community_id', c.community_id,
    'offer_type', 'free_event', 'ticket_capacity', 24, 'latitude', NULL, 'longitude', NULL);
  IF public.get_operator_event_draft_capability() IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Wrong protocol version'; END IF;
  saved := public.create_operator_event_draft(c.save_request, c.fields, c.community_id, 'free_event', 24, NULL, NULL);
  IF saved->>'status' IS DISTINCT FROM 'Draft' OR saved->>'offer_type' IS DISTINCT FROM 'free_event'
    OR (saved->>'ticket_capacity')::integer IS DISTINCT FROM 24 THEN RAISE EXCEPTION 'Wrong draft receipt'; END IF;
  IF public.create_operator_event_draft(c.save_request, c.fields, c.community_id, 'free_event', 24, NULL, NULL) IS DISTINCT FROM saved
    OR public.get_operator_event_draft_attempt(c.save_request) IS DISTINCT FROM saved
    OR public.cancel_operator_event_draft_attempt(c.save_request, input) IS DISTINCT FROM saved
  THEN RAISE EXCEPTION 'Recovery changed an existing draft'; END IF;
  BEGIN
    PERFORM public.create_operator_event_draft(c.save_request, c.fields || '{"title":"Different input"}', c.community_id, 'free_event', 24, NULL, NULL);
    RAISE EXCEPTION 'Changed input was accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  stopped := public.cancel_operator_event_draft_attempt(c.cancel_request, input);
  IF stopped->>'status' IS DISTINCT FROM 'Cancelled'
    OR public.create_operator_event_draft(c.cancel_request, c.fields, c.community_id, 'free_event', 24, NULL, NULL) IS DISTINCT FROM stopped
    OR public.get_operator_event_draft_attempt(c.cancel_request) IS DISTINCT FROM stopped
  THEN RAISE EXCEPTION 'A sealed request could be recreated'; END IF;
  BEGIN
    PERFORM 1 FROM public.operator_event_draft_attempts;
    RAISE EXCEPTION 'Private receipt table is readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- A different actor cannot retrieve the creator's receipt; no account is created.
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  IF public.get_operator_event_draft_attempt(c.save_request) IS NOT NULL THEN RAISE EXCEPTION 'Receipt crossed accounts'; END IF;
  PERFORM set_config('request.jwt.claim.sub', c.actor::text, true);
  UPDATE pg_temp.draft_recovery_qa SET receipt = saved;
END $qa$;
RESET ROLE;
DO $verify$
DECLARE c record;
BEGIN
  SELECT * INTO STRICT c FROM pg_temp.draft_recovery_qa;
  IF NOT EXISTS (SELECT 1 FROM public.explore_events e WHERE e.id = (c.receipt->>'event_id')::uuid
    AND e.status = 'Draft' AND e.offer_type = 'free_event' AND e.ticket_capacity = 24
    AND e.community_id = c.community_id AND e.host_user_id = c.actor AND e.pin_to_chat = false)
  THEN RAISE EXCEPTION 'Persisted draft does not match the receipt'; END IF;
  IF (SELECT count(*) FROM public.operator_event_draft_attempts WHERE user_id = c.actor
      AND request_id IN (c.save_request, c.cancel_request)) <> 2
    OR (SELECT count(*) FROM public.explore_events WHERE title = c.fields->>'title' AND community_id = c.community_id) <> 1
    OR (SELECT count(*) FROM public.community_topics WHERE community_id = c.community_id) <> c.topic_count
  THEN RAISE EXCEPTION 'Duplicate event, missing receipt, or unexpected chat'; END IF;
  IF has_function_privilege('anon', 'public.create_operator_event_draft(uuid,jsonb,uuid,text,integer,double precision,double precision)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.operator_event_draft_authorize(uuid)', 'EXECUTE')
  THEN RAISE EXCEPTION 'Unexpected callable privilege'; END IF;
END $verify$;
SELECT 'PASS: complete draft, same-request recovery, sealed cancellation, account isolation, private receipts, no chat; rolling back all test writes' AS result;
ROLLBACK;
-- Independent final baseline check: no test event or receipt should survive.
SELECT c.id, c.name, c.status, c.discoverable,
  NOT EXISTS (SELECT 1 FROM public.explore_events WHERE community_id = c.id AND title = 'WashedUp isolated draft recovery QA') AS no_test_event,
  NOT EXISTS (SELECT 1 FROM public.operator_event_draft_attempts WHERE community_id = c.id AND input->'fields'->>'title' = 'WashedUp isolated draft recovery QA') AS no_test_receipt
FROM public.communities c WHERE c.id = 'ed31b9f3-2b78-4690-88b2-c05b74265a11';
