-- Yours page rebuild — 9/9: clear the bell notification when a people
-- request is actioned from the Yours page swipe stack (not the bell).
--
-- REVIEW ONLY. Not applied by the agent. Additive and safe to ship ahead
-- of the flag flip (pure trigger on flag-off tables; no existing behaviour
-- depends on it).
--
-- Why: usePeopleConnectionMutations.accept_people_request /
-- decline_people_request only update people_connections — they don't touch
-- the recipient's app_notifications row. So if the user lands on the Yours
-- page directly (push, deep link, just opens the tab) and acts on the
-- terracotta request banner there, the matching 'people_request' bell
-- notification stays 'unread' and the badge keeps showing a phantom 1
-- until the user opens the bell and dismisses it manually. With the single
-- inbox after the dual-bell consolidation, this misalignment is more
-- visible. This trigger closes the loop atomically inside the same txn as
-- the status change, with no client work and no race.
--
-- Behaviour: when a people_connections row leaves 'pending' for any
-- terminal status (accepted / declined / removed), find the recipient's
-- unread 'people_request' notification authored by the requester and mark
-- it 'acted'. INSERT path is unchanged (notify_people_connection creates
-- the notification on the original request).

BEGIN;

CREATE OR REPLACE FUNCTION public.clear_request_notif_on_action()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only fire when a pending request was just decided. accepted->removed
  -- (post-acceptance unfriending) is a no-op here because no
  -- 'people_request' row is unread by then.
  IF OLD.status = 'pending' AND NEW.status <> 'pending' THEN
    UPDATE public.app_notifications
       SET status = 'acted'
     WHERE user_id       = NEW.recipient_user_id
       AND actor_user_id = NEW.requester_user_id
       AND type          = 'people_request'
       AND status        = 'unread';
  END IF;
  RETURN NEW;
END;
$$;

-- Inside the txn so the self-test below sees the final permission state.
-- Matches the convention of the other Yours trigger functions.
REVOKE EXECUTE ON FUNCTION public.clear_request_notif_on_action() FROM anon, public;

DROP TRIGGER IF EXISTS trg_clear_request_notif_on_action ON public.people_connections;
CREATE TRIGGER trg_clear_request_notif_on_action
  AFTER UPDATE OF status ON public.people_connections
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.clear_request_notif_on_action();

-- Self-test: function exists, is SECURITY DEFINER, search_path pinned,
-- anon has no EXECUTE; trigger is present and enabled.
DO $$
DECLARE
  v_def text;
  v_anon_can_exec boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'clear_request_notif_on_action'
  ) THEN
    RAISE EXCEPTION 'self-test failed: clear_request_notif_on_action function missing';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'clear_request_notif_on_action';
  IF position('SECURITY DEFINER' in v_def) = 0 THEN
    RAISE EXCEPTION 'self-test failed: clear_request_notif_on_action must be SECURITY DEFINER';
  END IF;
  IF position($pin$SET search_path TO 'public', 'pg_temp'$pin$ in v_def) = 0
     AND position('SET search_path TO public, pg_temp' in v_def) = 0 THEN
    RAISE EXCEPTION 'self-test failed: search_path must be pinned to public, pg_temp';
  END IF;

  SELECT has_function_privilege('anon', 'public.clear_request_notif_on_action()', 'EXECUTE')
    INTO v_anon_can_exec;
  IF v_anon_can_exec THEN
    RAISE EXCEPTION 'self-test failed: anon must not have EXECUTE on trigger fn';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'people_connections'
      AND t.tgname  = 'trg_clear_request_notif_on_action'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'self-test failed: trg_clear_request_notif_on_action missing';
  END IF;
END $$;

COMMIT;
