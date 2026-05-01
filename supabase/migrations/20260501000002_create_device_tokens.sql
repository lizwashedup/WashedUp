-- New device_tokens table for OneSignal migration. Replaces the single-column
-- profiles.expo_push_token shape. One user → N devices, properly modeled.
--
-- expo_push_token column on profiles is NOT dropped here; that happens during
-- cleanup (§8 Step 10) after OneSignal has been stable for 2+ weeks.

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  onesignal_player_id text NOT NULL UNIQUE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON public.device_tokens(user_id);

-- RLS: users see/manage their own tokens. Edge function uses service-role and
-- bypasses RLS for fanout reads.
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own_device_tokens ON public.device_tokens
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY users_insert_own_device_tokens ON public.device_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY users_update_own_device_tokens ON public.device_tokens
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY users_delete_own_device_tokens ON public.device_tokens
  FOR DELETE USING (auth.uid() = user_id);
