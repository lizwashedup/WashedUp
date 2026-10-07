-- REVIEW ONLY. Adapted to the captured September16 checkout definitions.
-- Additive label-only options reuse existing extra price/stock/order limits.
-- No provider action. Preserve original function ownership and ACLs.
BEGIN;
CREATE FUNCTION public.valid_ticket_addon_options(options jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE item jsonb; ids text[] := ARRAY[]::text[];
BEGIN
  IF options IS NULL OR jsonb_typeof(options) <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(options)>20 THEN RETURN false; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(options) LOOP
    IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string'
       OR length(item->>'id') NOT BETWEEN 1 AND 128
       OR btrim(item->>'id')<>item->>'id' OR btrim(item->>'id')=''
       OR length(btrim(item->>'label')) NOT BETWEEN 1 AND 120
       OR (item - 'id' - 'label') <> '{}'::jsonb OR (item->>'id')=ANY(ids)
    THEN RETURN false; END IF;
    ids := array_append(ids,item->>'id');
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.valid_ticket_addon_options(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.valid_ticket_addon_options(jsonb) TO authenticated,service_role;
ALTER TABLE public.event_add_ons ADD COLUMN variations jsonb NOT NULL DEFAULT '[]'::jsonb
  CONSTRAINT valid_ticket_addon_options CHECK (public.valid_ticket_addon_options(variations));
ALTER TABLE public.order_add_ons ADD COLUMN variation_id text, ADD COLUMN variation_label_snapshot text;
COMMENT ON COLUMN public.event_add_ons.variations IS 'Label-only choices, each {id,label}; extra price and shared stock are unchanged.';
COMMENT ON COLUMN public.order_add_ons.variation_label_snapshot IS 'Chosen label at order creation; survives later configuration edits.';
CREATE FUNCTION public.ticket_addon_option_label(options jsonb,pick jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE label text;
BEGIN
  IF NOT public.valid_ticket_addon_options(options) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='these extra options could not be checked.';
  END IF;
  IF jsonb_array_length(options)=0 AND pick IS NULL THEN RETURN NULL; END IF;
  IF pick IS NULL OR jsonb_typeof(pick)<>'string' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='choose an available option for each extra.';
  END IF;
  SELECT item->>'label' INTO label FROM jsonb_array_elements(options) item WHERE item->>'id'=pick#>>'{}';
  IF label IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='that option is no longer available.'; END IF;
  RETURN label;
END $$;
REVOKE ALL ON FUNCTION public.ticket_addon_option_label(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.begin_ticket_checkout(p_tier_id uuid, p_qty integer, p_buyer_user_id uuid, p_buyer_name text, p_idempotency_key text DEFAULT NULL::text, p_promo_code text DEFAULT NULL::text, p_add_ons jsonb DEFAULT NULL::jsonb, p_answers jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(order_id uuid, hold_id uuid, hold_expires_at timestamp with time zone, reference_code text, organizer_stripe_account_id text, is_free boolean, unit_face_cents integer, face_cents integer, processing_cents integer, commission_cents integer, total_cents integer, commission_bps_applied integer, stripe_checkout_session_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_checkout_ttl constant interval := interval '35 minutes';
  v_tier record; v_event record; v_payee_user uuid; v_acct record;
  v_unit integer; v_list_unit integer; v_face integer; v_processing integer;
  v_commission integer; v_total integer; v_hold uuid; v_hold_expires timestamptz;
  v_order uuid; v_free boolean; v_ref text; v_attempts int := 0; v_prior record;
  v_promo record; v_promo_id uuid := null; v_promo_snapshot text := null;
  v_promo_type text := null; v_promo_value integer := null;
  v_discount integer := 0; v_n int;
  v_item jsonb; v_ao record; v_ao_id uuid; v_ao_qty int;
  v_addon_total integer := 0; v_lines jsonb := '[]'::jsonb;
  v_aq record; v_a_qid uuid; v_a_ai int; v_a_val jsonb;
  v_alines jsonb := '[]'::jsonb; v_seen_a jsonb := '[]'::jsonb;
  v_a_ok boolean; v_i int;
  v_option_label text;
begin
  -- Same key lock as the buyer's explicit stop. Never recreate a stopped attempt.
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
    if exists(select 1 from public.ticket_checkout_attempt_stops s where s.idempotency_key=p_idempotency_key) then
      raise exception 'checkout attempt was stopped';
    end if;
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 50 then raise exception 'ticket quantity out of range'; end if;
  if p_buyer_user_id is null then raise exception 'a buyer is required'; end if;
  if coalesce(btrim(p_buyer_name), '') = '' then raise exception 'a buyer name is required'; end if;
  select t.id, t.event_id, t.price_cents, t.status, t.visibility, t.sales_open_at, t.sales_close_at, t.per_order_min, t.per_order_max
    into v_tier from public.ticket_tiers t where t.id = p_tier_id;
  if v_tier.id is null then raise exception 'unknown tier'; end if;
  select e.id, e.status, e.host_user_id, e.community_id, e.end_time into v_event
    from public.explore_events e where e.id = v_tier.event_id;
  if v_event.status <> 'Live' then raise exception 'this event is not open for sales'; end if;
  if v_event.end_time is not null and v_event.end_time < now() then raise exception 'this event has already ended'; end if;
  if v_tier.status <> 'on_sale' then raise exception 'this tier is not on sale'; end if;
  if v_tier.visibility = 'hidden' then raise exception 'this tier is not available'; end if;
  if (v_tier.sales_open_at is not null or v_tier.sales_close_at is not null)
     and not (now() >= coalesce(v_tier.sales_open_at, '-infinity'::timestamptz)
              and now() <= coalesce(v_tier.sales_close_at, 'infinity'::timestamptz)) then
    raise exception 'this tier is not on sale right now'; end if;
  if p_qty < v_tier.per_order_min then raise exception 'this tier needs at least % per order', v_tier.per_order_min; end if;
  if v_tier.per_order_max is not null and p_qty > v_tier.per_order_max then raise exception 'this tier allows at most % per order', v_tier.per_order_max; end if;

  v_list_unit := v_tier.price_cents;
  if p_promo_code is not null and btrim(p_promo_code) <> '' then
    select pc.id, pc.code, pc.discount_type, pc.discount_value, pc.max_uses, pc.uses_count, pc.starts_at, pc.ends_at, pc.active
      into v_promo from public.ticket_promo_codes pc
      where pc.event_id = v_event.id and lower(pc.code) = lower(btrim(p_promo_code));
    if v_promo.id is null or not v_promo.active then raise exception 'that code did not match anything for this event.'; end if;
    if v_promo.starts_at is not null and now() < v_promo.starts_at then raise exception 'that code is not live yet.'; end if;
    if v_promo.ends_at is not null and now() > v_promo.ends_at then raise exception 'that code has expired.'; end if;
    if v_promo.max_uses is not null and v_promo.uses_count >= v_promo.max_uses then raise exception 'that code has been used up.'; end if;
    if v_promo.discount_type is null then raise exception 'that code does not change the price.'; end if;
    if not public.promo_applies_to_tier(v_promo.id, p_tier_id) then
      raise exception 'that code does not work on this ticket.';
    end if;
    v_promo_id := v_promo.id; v_promo_snapshot := v_promo.code;
    v_promo_type := v_promo.discount_type; v_promo_value := v_promo.discount_value;
  end if;

  if p_add_ons is not null then
    if jsonb_typeof(p_add_ons) <> 'array' or jsonb_array_length(p_add_ons) = 0 or jsonb_array_length(p_add_ons) > 20 then
      raise exception 'add-ons must be a short list'; end if;
    -- Lock selected extras in a stable order: configuration and stock must
    -- describe the same choice captured on this order, even during an edit.
    perform a.id from public.event_add_ons a
      where a.event_id=v_event.id and a.id::text in
        (select item->>'add_on_id' from jsonb_array_elements(p_add_ons) item)
      order by a.id for update;
    for v_item in select * from jsonb_array_elements(p_add_ons) loop
      if jsonb_typeof(v_item->'qty') <> 'number' then raise exception 'each add-on needs a quantity'; end if;
      v_ao_qty := (v_item->>'qty')::int;
      begin v_ao_id := (v_item->>'add_on_id')::uuid;
      exception when others then raise exception 'each add-on needs its id'; end;
      if v_ao_qty is null or v_ao_qty < 1 or v_ao_qty > 50 then raise exception 'add-on quantity out of range'; end if;
      if v_lines @> jsonb_build_array(jsonb_build_object('id', v_ao_id)) then raise exception 'that add-on is listed twice.'; end if;
      select a.id, a.name, a.price_cents, a.quantity_cap, a.per_order_max, a.sales_open_at, a.sales_close_at, a.sold_count, a.status, a.variations
        into v_ao from public.event_add_ons a where a.id = v_ao_id and a.event_id = v_event.id;
      if v_ao.id is null or v_ao.status <> 'on_sale' then raise exception 'that add-on is not available.'; end if;
      if (v_ao.sales_open_at is not null and now() < v_ao.sales_open_at)
         or (v_ao.sales_close_at is not null and now() > v_ao.sales_close_at) then
        raise exception 'that add-on is not available right now.'; end if;
      if v_ao.per_order_max is not null and v_ao_qty > v_ao.per_order_max then
        raise exception 'that add-on allows at most % per order', v_ao.per_order_max; end if;
      if v_ao.quantity_cap is not null and v_ao.sold_count + v_ao_qty > v_ao.quantity_cap then
        raise exception 'that add-on just sold out.'; end if;
      v_option_label := public.ticket_addon_option_label(v_ao.variations, v_item->'variation_id');
      v_addon_total := v_addon_total + v_ao.price_cents * v_ao_qty;
      v_lines := v_lines || jsonb_build_object('id', v_ao_id, 'qty', v_ao_qty, 'price', v_ao.price_cents, 'name', v_ao.name, 'variation_id', v_item->>'variation_id', 'variation_label', v_option_label);
    end loop;
  end if;

  if p_answers is not null then
    if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) > 600 then
      raise exception 'answers must be a list'; end if;
    for v_item in select * from jsonb_array_elements(p_answers) loop
      begin v_a_qid := (v_item->>'question_id')::uuid;
      exception when others then raise exception 'each answer needs its question.'; end;
      if v_item ? 'attendee_index' and jsonb_typeof(v_item->'attendee_index') = 'number'
        then v_a_ai := (v_item->>'attendee_index')::int; else v_a_ai := null; end if;
      v_a_val := v_item->'value';
      if v_a_val is null or jsonb_typeof(v_a_val) = 'null' then
        raise exception 'that answer is empty.'; end if;
      select q.id, q.qtype, q.options, q.required, q.scope, q.is_active, q.prompt
        into v_aq from public.ticket_questions q
        where q.id = v_a_qid and q.event_id = v_event.id;
      if v_aq.id is null or not v_aq.is_active then
        raise exception 'that question is not part of this checkout.'; end if;
      if v_aq.scope = 'per_order' and v_a_ai is not null then
        raise exception 'that question is answered once for the whole order.'; end if;
      if v_aq.scope = 'per_attendee' and (v_a_ai is null or v_a_ai < 1 or v_a_ai > p_qty) then
        raise exception 'each guest needs their own answer here.'; end if;
      if v_seen_a @> jsonb_build_array(jsonb_build_object('q', v_a_qid, 'ai', coalesce(v_a_ai, 0))) then
        raise exception 'that question was answered twice.'; end if;
      v_seen_a := v_seen_a || jsonb_build_object('q', v_a_qid, 'ai', coalesce(v_a_ai, 0));
      v_a_ok := jsonb_typeof(v_a_val) = 'object' and case v_aq.qtype
        when 'short_text' then jsonb_typeof(v_a_val->'text') = 'string' and btrim(v_a_val->>'text') <> ''
        when 'paragraph'  then jsonb_typeof(v_a_val->'text') = 'string' and btrim(v_a_val->>'text') <> ''
        when 'terms'      then v_a_val->'accepted' = 'true'::jsonb
        when 'single_select' then jsonb_typeof(v_a_val->'choice') = 'string' and v_aq.options @> jsonb_build_array(v_a_val->'choice')
        when 'dropdown'      then jsonb_typeof(v_a_val->'choice') = 'string' and v_aq.options @> jsonb_build_array(v_a_val->'choice')
        when 'multi_select'  then jsonb_typeof(v_a_val->'choices') = 'array' and jsonb_array_length(v_a_val->'choices') >= 1 and v_aq.options @> (v_a_val->'choices')
        else false end;
      if not v_a_ok then
        if v_aq.qtype = 'terms' then
          raise exception 'the agreement has to be accepted to continue.';
        end if;
        raise exception 'that answer does not match its question.';
      end if;
      v_alines := v_alines || jsonb_build_object('qid', v_a_qid, 'ai', v_a_ai, 'val', v_a_val);
    end loop;
  end if;

  for v_aq in
    select q.id, q.prompt, q.scope from public.ticket_questions q
    where q.event_id = v_event.id and q.is_active and q.required
  loop
    if v_aq.scope = 'per_order' then
      if not exists (select 1 from jsonb_array_elements(v_alines) a
                     where (a->>'qid')::uuid = v_aq.id and (a->>'ai') is null) then
        raise exception 'please answer "%" before you pay.', v_aq.prompt;
      end if;
    else
      for v_i in 1..p_qty loop
        if not exists (select 1 from jsonb_array_elements(v_alines) a
                       where (a->>'qid')::uuid = v_aq.id and (a->>'ai')::int = v_i) then
          raise exception 'please answer "%" for each guest.', v_aq.prompt;
        end if;
      end loop;
    end if;
  end loop;

  select p.unit_face_cents, p.face_cents, p.discount_cents, p.processing_cents, p.total_cents, p.is_free
    into v_unit, v_face, v_discount, v_processing, v_total, v_free
  from public.price_ticket_checkout(v_list_unit, p_qty, v_promo_type, v_promo_value, v_addon_total) p;

  v_payee_user := v_event.host_user_id;
  if v_payee_user is null and v_event.community_id is not null then
    select c.created_by into v_payee_user from public.communities c where c.id = v_event.community_id; end if;
  if v_payee_user is null then raise exception 'this event has no organizer to pay'; end if;
  select a.stripe_account_id, a.commission_bps, a.charges_enabled into v_acct
    from public.organizer_stripe_accounts a where a.user_id = v_payee_user;
  if v_free then v_commission := 0;
  else
    if v_acct.stripe_account_id is null then raise exception 'the organizer has not set up payouts yet'; end if;
    if not v_acct.charges_enabled then raise exception 'the organizer cannot accept payments yet'; end if;
    v_commission := round((v_face::bigint * v_acct.commission_bps) / 10000.0)::integer;
  end if;

  if p_idempotency_key is not null then
    -- FIX 1: the stored session id rides back so the courier can reuse it.
    select o.id, o.hold_id, o.reference_code, o.status, o.tier_id, o.qty, o.buyer_user_id, o.unit_face_cents,
           o.face_cents, o.processing_cents, o.commission_cents, o.total_cents, o.commission_bps_applied,
           o.stripe_checkout_session_id
      into v_prior from public.ticket_orders o where o.idempotency_key = p_idempotency_key;
    if found then
      if v_prior.tier_id <> p_tier_id or v_prior.qty <> p_qty or v_prior.buyer_user_id <> p_buyer_user_id then
        raise exception 'idempotency key reused for a different checkout'; end if;
      if v_prior.status <> 'pending' then raise exception 'this checkout was already completed or expired; start a new order'; end if;
      select h.expires_at into v_hold_expires from public.ticket_holds h where h.id = v_prior.hold_id;
      -- FIX 2: free is face_cents = 0, price_ticket_checkout's own definition.
      -- unit_face_cents = 0 calls a free tier with a paid add-on free, and the
      -- courier then skips payment on a retry of an order it charged for.
      return query select v_prior.id, v_prior.hold_id, v_hold_expires, v_prior.reference_code,
        v_acct.stripe_account_id, (v_prior.face_cents = 0), v_prior.unit_face_cents, v_prior.face_cents,
        v_prior.processing_cents, v_prior.commission_cents, v_prior.total_cents, v_prior.commission_bps_applied,
        v_prior.stripe_checkout_session_id;
      return; end if;
  end if;

  loop
    v_ref := public.gen_ticket_reference_code();
    begin
      -- FIX 3: promo use, add-on stock and the hold claim all live INSIDE this
      -- subtransaction with the INSERT. They used to run before it, outside any
      -- handler, so a losing concurrent call committed its promo use, its
      -- add-on stock and an orphan hold even though its order was rejected.
      if v_promo_id is not null then
        update public.ticket_promo_codes pc set uses_count = pc.uses_count + 1
         where pc.id = v_promo_id and (pc.max_uses is null or pc.uses_count < pc.max_uses);
        get diagnostics v_n = row_count;
        if v_n = 0 then raise exception 'that code has been used up.'; end if;
      end if;

      for v_item in select * from jsonb_array_elements(v_lines) loop
        update public.event_add_ons a set sold_count = a.sold_count + (v_item->>'qty')::int, updated_at = now()
         where a.id = (v_item->>'id')::uuid and a.status = 'on_sale'
           and (a.quantity_cap is null or a.sold_count + (v_item->>'qty')::int <= a.quantity_cap);
        get diagnostics v_n = row_count;
        if v_n = 0 then raise exception 'that add-on just sold out.'; end if;
      end loop;

      v_hold := public.claim_ticket_hold(p_tier_id, p_qty, p_buyer_user_id);
      update public.ticket_holds h set expires_at = now() + c_checkout_ttl where h.id = v_hold returning h.expires_at into v_hold_expires;

      insert into public.ticket_orders (event_id, tier_id, hold_id, buyer_user_id, buyer_name_snapshot, qty,
        unit_face_cents, face_cents, discount_cents, processing_cents, commission_cents, total_cents,
        commission_bps_applied, status, reference_code, idempotency_key, promo_code_id, promo_code_snapshot)
      values (v_event.id, p_tier_id, v_hold, p_buyer_user_id, btrim(p_buyer_name), p_qty,
        v_unit, v_face, v_discount, v_processing, v_commission, v_total, coalesce(v_acct.commission_bps, 0),
        'pending', v_ref, p_idempotency_key, v_promo_id, v_promo_snapshot) returning id into v_order;
      exit;
    exception when unique_violation then
      -- everything in the block above is rolled back with the INSERT here
      if p_idempotency_key is not null then
        select o.id, o.hold_id, o.reference_code, o.tier_id, o.qty, o.buyer_user_id, o.unit_face_cents,
               o.face_cents, o.processing_cents, o.commission_cents, o.total_cents, o.commission_bps_applied,
               o.stripe_checkout_session_id
          into v_prior from public.ticket_orders o where o.idempotency_key = p_idempotency_key;
        if found then
          if v_prior.tier_id <> p_tier_id or v_prior.qty <> p_qty or v_prior.buyer_user_id <> p_buyer_user_id then
            raise exception 'idempotency key reused for a different checkout'; end if;
          select h.expires_at into v_hold_expires from public.ticket_holds h where h.id = v_prior.hold_id;
          return query select v_prior.id, v_prior.hold_id, v_hold_expires, v_prior.reference_code,
            v_acct.stripe_account_id, (v_prior.face_cents = 0), v_prior.unit_face_cents, v_prior.face_cents,
            v_prior.processing_cents, v_prior.commission_cents, v_prior.total_cents, v_prior.commission_bps_applied,
            v_prior.stripe_checkout_session_id;
          return; end if;
      end if;
      v_attempts := v_attempts + 1;
      if v_attempts >= 10 then raise exception 'could not allocate an order reference'; end if;
    end;
  end loop;

  for v_item in select * from jsonb_array_elements(v_lines) loop
    insert into public.order_add_ons (order_id, add_on_id, qty, unit_price_cents, name_snapshot, variation_id, variation_label_snapshot)
    values (v_order, (v_item->>'id')::uuid, (v_item->>'qty')::int, (v_item->>'price')::int, v_item->>'name', v_item->>'variation_id', v_item->>'variation_label');
  end loop;

  for v_item in select * from jsonb_array_elements(v_alines) loop
    insert into public.ticket_answers (order_id, question_id, attendee_index, value)
    values (v_order, (v_item->>'qid')::uuid, (v_item->>'ai')::int, v_item->'val');
  end loop;

  return query select v_order, v_hold, v_hold_expires, v_ref, v_acct.stripe_account_id, v_free,
    v_unit, v_face, v_processing, v_commission, v_total, coalesce(v_acct.commission_bps, 0), null::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.quote_ticket_checkout(p_tier_id uuid, p_qty integer, p_promo_code text DEFAULT NULL::text, p_add_ons jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(ok boolean, reason text, unit_face_cents integer, face_cents integer, discount_cents integer, processing_cents integer, total_cents integer, addon_total_cents integer, is_free boolean, promo_valid boolean, promo_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tier record; v_event record; v_promo record;
  v_promo_type text := null; v_promo_value integer := null;
  v_promo_valid boolean := false; v_promo_reason text := null;
  v_payee_user uuid; v_acct record; v_p record;
  v_item jsonb; v_ao record; v_ao_id uuid; v_ao_qty int;
  v_addon_total integer := 0; v_seen jsonb := '[]'::jsonb;
begin
  if p_qty is null or p_qty < 1 or p_qty > 50 then
    return query select false, 'pick a quantity between 1 and 50.'::text, 0,0,0,0,0,0, false, false, null::text;
    return; end if;
  select t.id, t.event_id, t.price_cents, t.status, t.visibility, t.sales_open_at, t.sales_close_at, t.per_order_min, t.per_order_max
    into v_tier from public.ticket_tiers t where t.id = p_tier_id;
  if v_tier.id is null OR NOT public.creator_event_is_visible(v_tier.event_id) then
    return query select false, 'that ticket is not available.'::text, 0,0,0,0,0,0, false, false, null::text;
    return; end if;
  select e.id, e.status, e.host_user_id, e.community_id, e.end_time into v_event
    from public.explore_events e where e.id = v_tier.event_id;
  if v_event.status <> 'Live' then
    return query select false, 'this event is not selling tickets right now.'::text, 0,0,0,0,0,0, false, false, null::text;
    return; end if;
  if v_event.end_time is not null and v_event.end_time < now() then
    return query select false, 'this event has already ended.'::text, 0,0,0,0,0,0, false, false, null::text;
    return; end if;
  if v_tier.status <> 'on_sale' or v_tier.visibility = 'hidden' then
    return query select false, 'that ticket is not on sale.'::text, 0,0,0,0,0,0, false, false, null::text;
    return; end if;
  if (v_tier.sales_open_at is not null or v_tier.sales_close_at is not null)
     and not (now() >= coalesce(v_tier.sales_open_at, '-infinity'::timestamptz)
              and now() <= coalesce(v_tier.sales_close_at, 'infinity'::timestamptz)) then
    return query select false, 'that ticket is not on sale right now.'::text, 0,0,0,0,0,0, false, false, null::text;
    return; end if;
  if p_qty < v_tier.per_order_min then
    return query select false, format('this ticket needs at least %s per order.', v_tier.per_order_min)::text,
      0,0,0,0,0,0, false, false, null::text;
    return; end if;
  if v_tier.per_order_max is not null and p_qty > v_tier.per_order_max then
    return query select false, format('this ticket allows at most %s per order.', v_tier.per_order_max)::text,
      0,0,0,0,0,0, false, false, null::text;
    return; end if;
  if public.get_ticket_tier_availability(p_tier_id) < p_qty then
    return query select false, 'there are not enough left.'::text, 0,0,0,0,0,0, false, false, null::text;
    return; end if;

  if p_add_ons is not null then
    if jsonb_typeof(p_add_ons) <> 'array' or jsonb_array_length(p_add_ons) = 0 or jsonb_array_length(p_add_ons) > 20 then
      return query select false, 'that add-on list is not valid.'::text, 0,0,0,0,0,0, false, false, null::text;
      return; end if;
    for v_item in select * from jsonb_array_elements(p_add_ons) loop
      if jsonb_typeof(v_item->'qty') <> 'number' then
        return query select false, 'each add-on needs a quantity.'::text, 0,0,0,0,0,0, false, false, null::text;
        return; end if;
      v_ao_qty := (v_item->>'qty')::int;
      begin v_ao_id := (v_item->>'add_on_id')::uuid;
      exception when others then
        return query select false, 'each add-on needs its id.'::text, 0,0,0,0,0,0, false, false, null::text;
        return; end;
      if v_ao_qty is null or v_ao_qty < 1 or v_ao_qty > 50 then
        return query select false, 'that add-on quantity is not valid.'::text, 0,0,0,0,0,0, false, false, null::text;
        return; end if;
      if v_seen @> jsonb_build_array(jsonb_build_object('id', v_ao_id)) then
        return query select false, 'that add-on is listed twice.'::text, 0,0,0,0,0,0, false, false, null::text;
        return; end if;
      select a.id, a.price_cents, a.quantity_cap, a.per_order_max, a.sales_open_at, a.sales_close_at, a.sold_count, a.status, a.variations
        into v_ao from public.event_add_ons a where a.id = v_ao_id and a.event_id = v_event.id;
      if v_ao.id is null or v_ao.status <> 'on_sale' then
        return query select false, 'that add-on is not available.'::text, 0,0,0,0,0,0, false, false, null::text;
        return; end if;
      if (v_ao.sales_open_at is not null and now() < v_ao.sales_open_at)
         or (v_ao.sales_close_at is not null and now() > v_ao.sales_close_at) then
        return query select false, 'that add-on is not available right now.'::text, 0,0,0,0,0,0, false, false, null::text;
        return; end if;
      if v_ao.per_order_max is not null and v_ao_qty > v_ao.per_order_max then
        return query select false, format('that add-on allows at most %s per order.', v_ao.per_order_max)::text,
          0,0,0,0,0,0, false, false, null::text;
        return; end if;
      if v_ao.quantity_cap is not null and v_ao.sold_count + v_ao_qty > v_ao.quantity_cap then
        return query select false, 'that add-on just sold out.'::text, 0,0,0,0,0,0, false, false, null::text;
        return; end if;
      begin
        perform public.ticket_addon_option_label(v_ao.variations, v_item->'variation_id');
      exception when invalid_parameter_value then
        return query select false, SQLERRM::text, 0,0,0,0,0,0, false, false, null::text;
        return;
      end;
      v_addon_total := v_addon_total + v_ao.price_cents * v_ao_qty;
      v_seen := v_seen || jsonb_build_object('id', v_ao_id);
    end loop;
  end if;

  if p_promo_code is not null and btrim(p_promo_code) <> '' then
    select pc.id, pc.discount_type, pc.discount_value, pc.max_uses, pc.uses_count, pc.starts_at, pc.ends_at, pc.active
      into v_promo from public.ticket_promo_codes pc
      where pc.event_id = v_event.id and lower(pc.code) = lower(btrim(p_promo_code));
    if v_promo.id is null or not v_promo.active then
      v_promo_reason := 'that code did not match anything for this event.';
    elsif v_promo.starts_at is not null and now() < v_promo.starts_at then
      v_promo_reason := 'that code is not live yet.';
    elsif v_promo.ends_at is not null and now() > v_promo.ends_at then
      v_promo_reason := 'that code has expired.';
    elsif v_promo.max_uses is not null and v_promo.uses_count >= v_promo.max_uses then
      v_promo_reason := 'that code has been used up.';
    elsif v_promo.discount_type is null then
      v_promo_reason := 'that code does not change the price.';
    elsif not public.promo_applies_to_tier(v_promo.id, p_tier_id) then
      v_promo_reason := 'that code does not work on this ticket.';
    else
      v_promo_valid := true; v_promo_type := v_promo.discount_type; v_promo_value := v_promo.discount_value;
    end if;
  end if;

  v_payee_user := v_event.host_user_id;
  if v_payee_user is null and v_event.community_id is not null then
    select c.created_by into v_payee_user from public.communities c where c.id = v_event.community_id; end if;
  select a.stripe_account_id, a.charges_enabled into v_acct
    from public.organizer_stripe_accounts a where a.user_id = v_payee_user;

  select * into v_p from public.price_ticket_checkout(v_tier.price_cents, p_qty, v_promo_type, v_promo_value, v_addon_total);

  if not v_p.is_free and (v_payee_user is null or v_acct.stripe_account_id is null
       or not coalesce(v_acct.charges_enabled, false)) then
    return query select false, 'this event cannot take payments yet.'::text, 0,0,0,0,0,0, false, v_promo_valid, v_promo_reason;
    return; end if;

  return query select true, null::text, v_p.unit_face_cents, v_p.face_cents, v_p.discount_cents,
    v_p.processing_cents, v_p.total_cents, v_addon_total, v_p.is_free, v_promo_valid, v_promo_reason;
end;
$function$;

COMMIT;
NOTIFY pgrst, 'reload schema';
