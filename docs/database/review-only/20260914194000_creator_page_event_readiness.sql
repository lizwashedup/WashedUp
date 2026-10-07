-- LOCAL / REVIEW ONLY. Published-page event readiness and content-only
-- cancellation boundary. No financial grants, refund calls or owner rewrites.
BEGIN;

DO $$ BEGIN IF md5(pg_get_functiondef('operator_update_explore_event(uuid,text,text,text,text,timestamp with time zone,text,text,text,text,text,text,boolean,text,timestamp with time zone,jsonb,text)'::regprocedure))<>'256d7ee4f8926b156cad15966cc4f8e2' THEN RAISE EXCEPTION 'Reconcile current operator_update_explore_event before event readiness'; END IF; END $$;

DO $$ BEGIN IF md5(pg_get_functiondef('publish_creator_page_event(uuid,uuid)'::regprocedure))<>'abad07c23d8cc6913da7949f10f8ada6' THEN RAISE EXCEPTION 'Reconcile current publish_creator_page_event before event readiness'; END IF; END $$;

CREATE FUNCTION public.creator_page_event_readiness(p_page_id uuid,p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.explore_events; v_payee uuid; v_offer text; v_paid boolean; v_on_sale boolean;
 v_ready boolean; v_refunds boolean; v_reason text; v_sessions integer;
BEGIN
 SELECT * INTO e FROM public.explore_events WHERE id=p_event_id;
 IF auth.uid() IS NULL OR e.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.creator_page_events WHERE page_id=p_page_id AND event_id=p_event_id)
 OR NOT public.creator_event_can_manage(p_event_id) THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
 v_payee:=coalesce(e.host_user_id,(SELECT created_by FROM public.communities WHERE id=e.community_id));
 v_offer:=to_jsonb(e)->>'offer_type';
 SELECT coalesce(bool_or(price_cents>0),false),coalesce(bool_or(price_cents>0 AND status='on_sale'),false)
 INTO v_paid,v_on_sale FROM public.ticket_tiers WHERE event_id=e.id;
 SELECT EXISTS(SELECT 1 FROM public.organizer_stripe_accounts WHERE user_id=v_payee AND charges_enabled AND payouts_enabled)
 INTO v_ready;
 -- Mirrors the retained cancellation reader's live-seat status, additionally
 -- refusing to assume a malformed paid order with no positions is settled.
 SELECT EXISTS(SELECT 1 FROM public.ticket_orders o WHERE o.event_id=e.id AND o.status='paid' AND (
  NOT EXISTS(SELECT 1 FROM public.ticket_order_positions x WHERE x.order_id=o.id)
  OR EXISTS(SELECT 1 FROM public.ticket_order_positions x WHERE x.order_id=o.id AND x.voided_at IS NULL))) INTO v_refunds;
 v_reason:=CASE
  WHEN NOT public.creator_page_is_visible(p_page_id) THEN 'page_unpublished'
  WHEN e.status NOT IN('Draft','Live') THEN 'event_closed'
  WHEN v_offer IS NULL THEN 'offer_setup_unavailable'
  WHEN v_offer NOT IN('free_event','ticketed_event','course','drop_in') THEN 'offer_not_supported'
  WHEN e.event_date IS NULL THEN 'date_required'
  WHEN (v_offer='ticketed_event' OR v_paid) AND e.end_time IS NULL THEN 'end_time_required'
  WHEN v_offer='ticketed_event' AND NOT v_on_sale THEN 'paid_ticket_required'
  WHEN v_paid AND NOT v_ready THEN 'payout_setup_required'
  ELSE NULL END;
 IF v_reason IS NULL AND v_offer='course' THEN
  IF to_regclass('public.event_offer_sessions') IS NULL THEN v_reason:='course_setup_unavailable';
  ELSE
   EXECUTE 'SELECT count(*) FROM public.event_offer_sessions WHERE event_id=$1' INTO v_sessions USING e.id;
   IF v_sessions<2 THEN v_reason:='course_dates_required'; END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('page_id',p_page_id,'event_id',e.id,'status',e.status,
  'offer_type',v_offer,'publish_ready',v_reason IS NULL,'publish_reason',v_reason,
  'has_paid_tiers',v_paid,'has_paid_tier_on_sale',v_on_sale,'payout_ready',v_ready,
  'can_manage_tickets',public.is_ticketing_organizer(e.id,auth.uid()),
  'cancellation_requires_refunds',v_refunds,'can_cancel_without_refunds',NOT v_refunds);
END;
$$;
REVOKE ALL ON FUNCTION public.creator_page_event_readiness(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_page_event_readiness(uuid,uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.operator_update_explore_event(p_event_id uuid, p_title text, p_description text DEFAULT NULL::text, p_image_url text DEFAULT NULL::text, p_event_date text DEFAULT NULL::text, p_start_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_venue text DEFAULT NULL::text, p_venue_address text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_external_url text DEFAULT NULL::text, p_ticket_price text DEFAULT NULL::text, p_public_name text DEFAULT NULL::text, p_pin_to_chat boolean DEFAULT true, p_status text DEFAULT NULL::text, p_end_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_description_blocks jsonb DEFAULT NULL::jsonb, p_confirmation_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_page uuid;
  v_readiness jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select id, host_user_id, community_id, status into v_row
  from explore_events where id = p_event_id;
  if v_row.id is null then
    raise exception 'Event not found';
  end if;
  if not (v_row.host_user_id = v_uid
          or (v_row.community_id is not null and is_community_leader(v_row.community_id, v_uid))
          or public.creator_page_team_event_can_manage(p_event_id)) then
    raise exception 'Not authorized';
  end if;
  -- New page teammates have content authority only. Existing owner and
  -- legacy co-leader financial/cancellation paths remain unchanged.
  if not (coalesce(v_row.host_user_id = v_uid,false)
          or (v_row.community_id is not null and is_community_leader(v_row.community_id,v_uid)))
     and (p_status='Cancelled' or (p_status='Live' and v_row.status='Draft')) then
    select page_id into v_page from public.creator_page_events where event_id=p_event_id;
    v_readiness:=public.creator_page_event_readiness(v_page,p_event_id);
    if p_status='Cancelled' and (v_readiness->>'cancellation_requires_refunds')::boolean then
      raise exception 'The event organizer needs to complete ticket refunds before this event can be canceled.' using errcode='PT409';
    end if;
    if p_status='Live' and not (v_readiness->>'publish_ready')::boolean then
      raise exception 'Finish the event publishing setup before publishing.' using errcode='PT409',detail=v_readiness->>'publish_reason';
    end if;
  end if;
  if coalesce(btrim(p_title), '') = '' or char_length(p_title) > 120 then
    raise exception 'A title is required.';
  end if;
  if p_status is not null and p_status not in ('Live', 'Completed', 'Cancelled') then
    raise exception 'Invalid status';
  end if;
  if v_row.status = 'Draft' and p_status in ('Completed', 'Cancelled') then
    -- LIZ COPY
    raise exception 'This one is still a draft. Publish it or keep shaping it.';
  end if;
  if coalesce(btrim(p_category), '') = '' then
    raise exception 'Pick a category.';
  end if;
  -- S5: Live (asked for or carried through the full overwrite) keeps a date;
  -- this also blocks blanking the date on a Live event. Cancel/complete of a
  -- dateless legacy row stays allowed. (LIZ COPY guard)
  if coalesce(p_status, v_row.status) = 'Live'
     and coalesce(btrim(p_event_date), '') = '' then
    raise exception 'Pick a date.';
  end if;
  -- 75: when both times exist, order them (client-surfaced guard)
  if p_end_time is not null and p_start_time is not null
     and p_end_time <= p_start_time then
    raise exception 'The end has to come after the start.';
  end if;
  -- SQL-96: the friendly cap, ahead of the CHECK (LIZ COPY)
  if p_confirmation_message is not null and char_length(p_confirmation_message) > 2500 then
    raise exception 'Keep the confirmation note under 2500 characters.';
  end if;

  update explore_events set
    title = btrim(p_title),
    description = nullif(btrim(p_description), ''),
    image_url = nullif(btrim(p_image_url), ''),
    event_date = nullif(btrim(p_event_date), '')::date,
    start_time = p_start_time,
    end_time = p_end_time,
    venue = nullif(btrim(p_venue), ''),
    venue_address = nullif(btrim(p_venue_address), ''),
    category = nullif(btrim(p_category), ''),
    external_url = nullif(btrim(p_external_url), ''),
    ticket_price = nullif(btrim(p_ticket_price), '')::numeric,
    public_name = nullif(btrim(p_public_name), ''),
    pin_to_chat = coalesce(p_pin_to_chat, true),
    status = coalesce(p_status, status),
    -- 77's DOCUMENTED DEVIATION from full-overwrite: null = leave the rich
    -- body untouched (it is large and easy to lose); [] = clear it
    description_blocks = coalesce(p_description_blocks, description_blocks),
    -- SQL-96, same deviation on purpose: null = keep, '' = clear
    confirmation_message = case
      when p_confirmation_message is null then confirmation_message
      else nullif(btrim(p_confirmation_message), '')
    end,
    updated_at = now()
  where id = p_event_id;

  -- publish flip: the event chat is born NOW; the partial unique index
  -- (one topic per event) makes a double-publish a clean no-op
  if v_row.status = 'Draft' and p_status = 'Live' and v_row.community_id is not null then
    insert into community_topics (community_id, name, created_by, explore_event_id)
    values (v_row.community_id, left(btrim(p_title), 60), v_uid, p_event_id)
    on conflict (explore_event_id) where explore_event_id is not null do nothing;
  end if;

  update community_topics
  set name = left(btrim(p_title), 60),
      archived = archived or coalesce(p_status, '') in ('Cancelled', 'Completed')
  where explore_event_id = p_event_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_creator_page_event(p_page_id uuid, p_event_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p public.creator_page_drafts; e public.explore_events; v_readiness jsonb;
BEGIN
 SELECT * INTO p FROM public.creator_page_drafts WHERE id=p_page_id FOR UPDATE;
 IF auth.uid() IS NULL OR p.id IS NULL OR (p.owner_id<>auth.uid() AND NOT (p.page_kind='community' AND public.is_community_leader(p.id,auth.uid())) AND NOT public.creator_page_team_can_manage(p.id,'page_events')) OR NOT public.creator_page_is_visible(p.id) THEN
  RAISE EXCEPTION 'Publish your approved page before its event' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.creator_page_events WHERE page_id=p.id AND event_id=p_event_id) THEN
  RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 IF e.status='Live' THEN RETURN e.id; END IF;
 IF e.status<>'Draft' THEN RAISE EXCEPTION 'This event cannot be published' USING ERRCODE='PT409'; END IF;
 IF p.owner_id<>auth.uid() AND NOT (p.page_kind='community' AND public.is_community_leader(p.id,auth.uid())) THEN
  v_readiness:=public.creator_page_event_readiness(p.id,e.id);
  IF NOT (v_readiness->>'publish_ready')::boolean THEN
   RAISE EXCEPTION 'Finish the event publishing setup before publishing.' USING ERRCODE='PT409',DETAIL=v_readiness->>'publish_reason'; END IF;
 END IF;
 -- Reuse full-field update + existing event-topic creation, keeping saved IDs,
 -- ticket settings, rich description and buyer confirmation unchanged.
 PERFORM public.operator_update_explore_event(p_event_id=>e.id,p_title=>e.title,p_description=>e.description,
  p_image_url=>e.image_url,p_event_date=>e.event_date::text,p_start_time=>e.start_time,p_end_time=>e.end_time,
  p_venue=>e.venue,p_venue_address=>e.venue_address,p_category=>e.category,p_external_url=>e.external_url,
  p_ticket_price=>e.ticket_price::text,p_public_name=>e.public_name,p_pin_to_chat=>e.pin_to_chat,p_status=>'Live',
  p_description_blocks=>e.description_blocks,p_confirmation_message=>e.confirmation_message);
 RETURN e.id;
END;
$function$;

COMMIT;
