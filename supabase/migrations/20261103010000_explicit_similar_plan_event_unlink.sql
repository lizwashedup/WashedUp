-- A next-time copy is a new plan, not a group attending the old source event.
-- Keep the existing auto-link function and ordinary creation behavior intact;
-- only an explicit opt-out skips the legacy title-based association trigger.
BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS skip_explore_auto_link boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.skip_explore_auto_link IS
  'True for independently recreated plans: do not infer an explore event from the title on insert. Explicit explore_event_id values are preserved.';

CREATE OR REPLACE TRIGGER auto_link_explore_event_trigger
  BEFORE INSERT ON public.events
  FOR EACH ROW
  WHEN (NOT NEW.skip_explore_auto_link)
  EXECUTE FUNCTION public.auto_link_explore_event();

NOTIFY pgrst, 'reload schema';
COMMIT;
