import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifiedPushSubscription } from '../_shared/oneSignalSubscriptionClaim.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')!;
const ONESIGNAL_REST_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY')!;
const ONESIGNAL_BASE = 'https://api.onesignal.com';
const SUBSCRIPTION_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json(405, { status: 'method-not-allowed' });

  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return json(401, { status: 'unauthorized' });

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return json(401, { status: 'unauthorized' });

  let body: { subscriptionId?: unknown; platform?: unknown };
  try { body = await req.json(); } catch { return json(400, { status: 'invalid-request' }); }
  const subscriptionId = typeof body.subscriptionId === 'string' ? body.subscriptionId.trim() : '';
  const platform = body.platform;
  if (!SUBSCRIPTION_ID.test(subscriptionId) || (platform !== 'ios' && platform !== 'android')) {
    return json(400, { status: 'invalid-request' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(
      `${ONESIGNAL_BASE}/apps/${ONESIGNAL_APP_ID}/users/by/external_id/${encodeURIComponent(user.id)}`,
      {
        headers: { Authorization: `Key ${ONESIGNAL_REST_API_KEY}` },
        signal: controller.signal,
      },
    );
  } catch {
    clearTimeout(timeout);
    return json(503, { status: 'provider-unavailable' });
  }
  clearTimeout(timeout);

  if (response.status === 404) return json(409, { status: 'identity-pending' });
  if (!response.ok) return json(503, { status: 'provider-unavailable' });

  const providerUser = await response.json().catch(() => null);
  const verified = verifiedPushSubscription(providerUser, subscriptionId);
  if (!verified) return json(409, { status: 'identity-pending' });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date().toISOString();
  const { error } = await admin.from('device_tokens').upsert({
    user_id: user.id,
    platform,
    onesignal_player_id: verified.id,
    last_seen_at: now,
    push_enabled: true,
    notification_types: verified.notificationTypes,
    enabled_synced_at: now,
  }, { onConflict: 'onesignal_player_id' });

  if (error) {
    console.error('[claim-push-subscription] write failed:', error.message);
    return json(503, { status: 'write-failed' });
  }
  return json(200, { status: 'claimed', subscriptionId: verified.id });
});
