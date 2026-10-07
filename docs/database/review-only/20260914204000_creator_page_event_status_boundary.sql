-- LOCAL / REVIEW ONLY. Preserve the existing event update; close measured
-- page publication and null-owner authorization bypasses. No financial grants.
BEGIN;
DO $$ BEGIN IF md5(pg_get_functiondef('public.operator_update_explore_event(uuid,text,text,text,text,timestamp with time zone,text,text,text,text,text,text,boolean,text,timestamp with time zone,jsonb,text)'::regprocedure))<>'836caa3e1bb5ad7c8f618cd2dff468b1' THEN RAISE EXCEPTION 'Reconcile current event status function before correction'; END IF; END $$;
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
  from explore_events where id = p_event_id FOR UPDATE;
  if v_row.id is null then
    raise exception 'Event not found';
  end if;
  if not coalesce((v_row.host_user_id = v_uid
          or (v_row.community_id is not null and is_community_leader(v_row.community_id, v_uid))
          or public.creator_page_team_event_can_manage(p_event_id)),false) then
    raise exception 'Not authorized';
  end if;
  -- New page teammates have content authority only. Existing owner and
  -- legacy co-leader financial/cancellation paths remain unchanged.
  if not (coalesce(v_row.host_user_id = v_uid,false)
          or (v_row.community_id is not null and is_community_leader(v_row.community_id,v_uid)))
     and p_status='Cancelled' then
    select page_id into v_page from public.creator_page_events where event_id=p_event_id;
    v_readiness:=public.creator_page_event_readiness(v_page,p_event_id);
    if p_status='Cancelled' and (v_readiness->>'cancellation_requires_refunds')::boolean then
      raise exception 'The event organizer needs to complete ticket refunds before this event can be canceled.' using errcode='PT409';
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

  -- Validate the actual submitted fields before making any page event live.
  -- Failure rolls back the full overwrite above. Unmapped standalone events
  -- keep their original publication routine; all page publishers share this gate.
  if p_status='Live' then
    select page_id into v_page from public.creator_page_events where event_id=p_event_id;
    if v_page is not null then
      if v_row.status not in ('Draft','Live') then
        raise exception 'This event cannot be published' using errcode='PT409';
      end if;
      if v_row.status='Draft' then
        v_readiness:=public.creator_page_event_readiness(v_page,p_event_id);
        if not (v_readiness->>'publish_ready')::boolean then
          raise exception 'Finish the event publishing setup before publishing.' using errcode='PT409',detail=v_readiness->>'publish_reason';
        end if;
      end if;
    end if;
  end if;

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

COMMIT;
