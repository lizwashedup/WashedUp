CREATE OR REPLACE FUNCTION public.decrement_member_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'joined' THEN
    UPDATE events SET member_count = member_count - 1 WHERE id = OLD.event_id;
  END IF;
  RETURN OLD;
END;
$function$;
