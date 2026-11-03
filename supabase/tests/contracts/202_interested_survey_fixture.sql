-- Exact unchanged RPC definitions inspected in production on 2026-11-02.
-- Fictional data and isolated PostgreSQL only; no provider/notification work.
CREATE TABLE public.profiles(id uuid PRIMARY KEY, first_name_display text);
CREATE TABLE public.event_interest_signals(
 id uuid PRIMARY KEY, event_id uuid REFERENCES public.events(id), interested_user_id uuid REFERENCES public.profiles(id),
 creator_id uuid REFERENCES public.profiles(id), status text DEFAULT 'active', created_at timestamptz DEFAULT now(), expired_at timestamptz, expiry_reason text
);
CREATE TABLE public.event_members(event_id uuid REFERENCES public.events(id),user_id uuid REFERENCES public.profiles(id),PRIMARY KEY(event_id,user_id));
CREATE TABLE public.no_show_reports(event_id uuid,reporter_user_id uuid,no_show_user_id uuid,created_at timestamptz DEFAULT now(),UNIQUE(event_id,reporter_user_id,no_show_user_id));
ALTER TABLE public.event_interest_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.no_show_reports ENABLE ROW LEVEL SECURITY;
INSERT INTO public.profiles VALUES
 ('11111111-1111-4111-8111-111111111111','Alex'),('22222222-2222-4222-8222-222222222222','Amelia'),('33333333-3333-4333-8333-333333333333','Jamie');
INSERT INTO public.events(id,creator_user_id,title,status) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Sunset picnic','completed'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','Coffee before the beach','completed'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','A Sunday walk','completed');
INSERT INTO public.event_interest_signals(id,event_id,interested_user_id,creator_id) VALUES
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
INSERT INTO public.event_members SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',id FROM public.profiles;
CREATE OR REPLACE FUNCTION public.get_user_interest_signals()
 RETURNS TABLE(signal_id uuid, event_id uuid, event_title text, creator_id uuid, creator_name text, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    s.id,
    s.event_id,
    e.title,
    s.creator_id,
    p.first_name_display,
    s.created_at
  from event_interest_signals s
  join events   e on e.id = s.event_id
  join profiles p on p.id = s.creator_id
  where s.interested_user_id = auth.uid()
    and s.status = 'active'
  order by s.created_at desc;
$function$
;
CREATE OR REPLACE FUNCTION public.remove_interest_signal(p_signal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_owner   uuid;
  v_status  text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select interested_user_id, status into v_owner, v_status
  from event_interest_signals where id = p_signal_id;

  if v_owner is null or v_owner <> v_user_id then
    raise exception 'not your signal' using errcode = '42501';
  end if;
  if v_status <> 'active' then
    return;
  end if;

  update event_interest_signals
     set status = 'removed',
         expired_at = now(),
         expiry_reason = 'user_removed'
   where id = p_signal_id;
end;
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
      AND r.no_show_user_id=p_no_show_user_id)
  ON CONFLICT (event_id,reporter_user_id,no_show_user_id) DO NOTHING;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_user_interest_signals(), public.remove_interest_signal(uuid), public.report_no_show(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_interest_signals(), public.remove_interest_signal(uuid), public.report_no_show(uuid,uuid) TO authenticated;
