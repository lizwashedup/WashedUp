-- follow-up to 20260823140200: that migration cast event_date but missed
-- ticket_price, which is also not text -- explore_events.ticket_price is
-- numeric. Caught by re-running `supabase db lint --linked` after applying
-- the first fix (the plpgsql checker reports the first type error per
-- statement, so this was hidden behind the event_date error until that one
-- was fixed). Confirmed live: title/description/category/image_url/
-- external_url/venue/venue_address/status are genuinely text (no cast
-- needed); only event_date (date) and ticket_price (numeric) are not.
-- Verified against a scratch Postgres instance with the real column types
-- before applying: both RPCs now write a real numeric ticket_price.

CREATE OR REPLACE FUNCTION public.admin_create_explore_event(p_title text, p_description text DEFAULT NULL::text, p_image_url text DEFAULT NULL::text, p_event_date text DEFAULT NULL::text, p_venue text DEFAULT NULL::text, p_venue_address text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_external_url text DEFAULT NULL::text, p_ticket_price text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  INSERT INTO explore_events (title, description, image_url, event_date, venue, venue_address, category, external_url, ticket_price, status)
  VALUES (p_title, NULLIF(TRIM(p_description), ''), NULLIF(TRIM(p_image_url), ''), NULLIF(TRIM(p_event_date), '')::date, NULLIF(TRIM(p_venue), ''), NULLIF(TRIM(p_venue_address), ''), NULLIF(TRIM(p_category), ''), NULLIF(TRIM(p_external_url), ''), NULLIF(TRIM(p_ticket_price), '')::numeric, 'Live')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_explore_event(p_event_id uuid, p_title text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_image_url text DEFAULT NULL::text, p_event_date text DEFAULT NULL::text, p_venue text DEFAULT NULL::text, p_venue_address text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_external_url text DEFAULT NULL::text, p_ticket_price text DEFAULT NULL::text, p_status text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE explore_events SET
    title = COALESCE(NULLIF(TRIM(p_title), ''), title),
    description = CASE WHEN p_description IS NOT NULL THEN NULLIF(TRIM(p_description), '') ELSE description END,
    image_url = CASE WHEN p_image_url IS NOT NULL THEN NULLIF(TRIM(p_image_url), '') ELSE image_url END,
    event_date = CASE WHEN p_event_date IS NOT NULL THEN NULLIF(TRIM(p_event_date), '')::date ELSE event_date END,
    venue = CASE WHEN p_venue IS NOT NULL THEN NULLIF(TRIM(p_venue), '') ELSE venue END,
    venue_address = CASE WHEN p_venue_address IS NOT NULL THEN NULLIF(TRIM(p_venue_address), '') ELSE venue_address END,
    category = CASE WHEN p_category IS NOT NULL THEN NULLIF(TRIM(p_category), '') ELSE category END,
    external_url = CASE WHEN p_external_url IS NOT NULL THEN NULLIF(TRIM(p_external_url), '') ELSE external_url END,
    ticket_price = CASE WHEN p_ticket_price IS NOT NULL THEN NULLIF(TRIM(p_ticket_price), '')::numeric ELSE ticket_price END,
    status = COALESCE(NULLIF(TRIM(p_status), ''), status)
  WHERE id = p_event_id;
END;
$function$;
