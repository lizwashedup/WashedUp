-- Private review only. Keep the daily job, its privileges, and the 90-day
-- interval. An intentional re-raise reuses the original row and stamps
-- reactivated_at; an ordinary retry on an active signal does not.
begin;
do $patch$
declare
  original text := pg_get_functiondef('public.expire_stale_interests()'::regprocedure);
  anchor text := $old$and created_at < now() - interval '90 days'$old$;
  replacement text := $new$and coalesce(reactivated_at, created_at) < now() - interval '90 days'$new$;
begin
  if array_length(string_to_array(original, anchor), 1) is distinct from 2 then
    raise exception 'Unexpected interest expiration function; review the schema copy';
  end if;
  if not exists (select 1 from pg_attribute
      where attrelid = 'public.event_interest_signals'::regclass
        and attname = 'reactivated_at' and not attisdropped and atttypid = 'timestamptz'::regtype) then
    raise exception 'Expected a reactivation timestamp; review the schema copy';
  end if;
  execute replace(original, anchor, replacement);
end;
$patch$;
commit;
