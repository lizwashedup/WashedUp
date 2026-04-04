-- Auto-ban: if a user accumulates 3 or more reports, ban their auth record immediately.
-- The ban sets banned_until to 2099 so they cannot sign in.
-- This runs in addition to (not instead of) the existing notify-report email alert.

CREATE OR REPLACE FUNCTION auto_ban_reported_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  report_count integer;
BEGIN
  -- Count all reports filed against this user (including the new one)
  SELECT COUNT(*) INTO report_count
  FROM reports
  WHERE reported_user_id = NEW.reported_user_id;

  IF report_count >= 3 THEN
    -- Ban auth record — prevents sign-in but keeps email "taken"
    UPDATE auth.users
    SET banned_until = '2099-01-01 00:00:00+00'
    WHERE id = NEW.reported_user_id
      AND (banned_until IS NULL OR banned_until < NOW());
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the report insert if this fails
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_report_auto_ban ON reports;
CREATE TRIGGER on_report_auto_ban
  AFTER INSERT ON reports
  FOR EACH ROW
  EXECUTE FUNCTION auto_ban_reported_user();
