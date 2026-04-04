-- 20260305000000 added 'new_message' but accidentally dropped 'invite_accepted'.
-- Restore the full constraint.

ALTER TABLE app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_type_check;

ALTER TABLE app_notifications
  ADD CONSTRAINT app_notifications_type_check
  CHECK (type IN (
    'waitlist_spot', 'broadcast', 'event_reminder',
    'member_joined', 'plan_invite', 'invite_accepted', 'new_message'
  ));
