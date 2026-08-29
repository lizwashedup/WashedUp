CREATE OR REPLACE FUNCTION admin_send_user_notification(
  p_user_id uuid,
  p_title text,
  p_body text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO app_notifications (user_id, type, title, body)
  VALUES (p_user_id, 'broadcast', p_title, p_body)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
