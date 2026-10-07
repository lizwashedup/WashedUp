-- OneSignal is the source of truth for whether a device is currently
-- reachable. These columns already exist in production; this idempotent
-- migration restores the schema contract to the release source so future
-- environments and sender revisions are reproducible.
ALTER TABLE public.device_tokens
  ADD COLUMN IF NOT EXISTS push_enabled boolean,
  ADD COLUMN IF NOT EXISTS notification_types integer,
  ADD COLUMN IF NOT EXISTS enabled_synced_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_device_tokens_reachability
  ON public.device_tokens (user_id, push_enabled, enabled_synced_at DESC);

COMMENT ON COLUMN public.device_tokens.push_enabled IS
  'Last provider-confirmed OneSignal subscription reachability; null means not yet synchronized.';
COMMENT ON COLUMN public.device_tokens.enabled_synced_at IS
  'Time push_enabled and notification_types were last read from OneSignal.';
