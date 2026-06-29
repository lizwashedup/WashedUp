import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const ALERT_EMAIL = 'liz@washedup.app';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Watchdog: scheduled every 5 min via pg_cron. Three independent checks, each
// emailing Liz via Resend (email is the sink: a push-outage alarm must not ride
// push). NONE of this touches app_notifications.
//   1. recent_edge_function_failures: 4xx/5xx from pg_net edge calls (15m). The
//      original check (a verify_jwt flip took push down silently for 4 days).
//   2. push_registration_health: device_tokens minted/refreshed in 24h, catches
//      the 2026-06 empty-App-ID outage, which returned 200 everywhere while
//      registration cratered (the gap that hid it for 9 days).
//   3. push_delivery_health: OneSignal delivered ratio over 90m above a volume
//      floor, catches a true transport collapse.
// Debounce lives in record_push_health (email on healthy->unhealthy transition,
// then at most once / 6h while unhealthy).
//
// IMPORTANT: this function stays verify_jwt=false. If it ever gets redeployed
// with verify_jwt=true the watchdog goes silent and we lose observability of the
// very thing it watches. ALWAYS deploy with --no-verify-jwt.

function esc(s: unknown): string {
  return String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
}

async function sendAlert(subject: string, html: string): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'WashedUp Alerts <plans@washedup.app>', to: [ALERT_EMAIL], subject, html }),
  });
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const result: Record<string, unknown> = {};

  // Check 1: 4xx/5xx from pg_net edge calls (last 15 min). No early return.
  const { data: failures, error: failErr } = await supabase.rpc('recent_edge_function_failures', { window_minutes: 15 });
  if (failErr) {
    result.failuresError = failErr.message;
  } else {
    const failureRows = failures ?? [];
    result.failures = failureRows.length;
    if (failureRows.length > 0) {
      const sampleHtml = failureRows.slice(0, 5)
        .map((f: any) => `<li><strong>${esc(f.created)}</strong>: HTTP ${esc(f.status_code)} <code>${esc(String(f.content ?? '').slice(0, 200))}</code></li>`)
        .join('');
      const html = `
        <div style="font-family:-apple-system,sans-serif;max-width:600px">
          <h2 style="color:#C43D2E;margin:0 0 4px 0">Push pipeline alert</h2>
          <p>Detected <strong>${failureRows.length}</strong> failed edge function call(s) from Postgres triggers in the last 15 minutes.</p>
          <p>Usually a DB-trigger edge fn (<code>send-push-notifications</code> / <code>notify-plan-posted</code>) rejecting with 4xx/5xx, most often <code>verify_jwt</code> flipped to <code>true</code> on a redeploy.</p>
          <h3>Sample failures</h3><ul>${sampleHtml}</ul>
          <p>If <code>verify_jwt</code> is true, redeploy with <code>--no-verify-jwt</code>.</p>
        </div>`.trim();
      result.failuresAlerted = await sendAlert(`[ALERT] Push pipeline failing: ${failureRows.length} errors in last 15min`, html);
    }
  }

  // Check 2: registration health (24h tokens minted/refreshed).
  const { data: reg, error: regErr } = await supabase.rpc('push_registration_health');
  if (regErr) {
    result.registrationError = regErr.message;
  } else if (reg?.[0]) {
    const r = reg[0] as { new_24h: number; refresh_24h: number; active_24h: number; healthy: boolean };
    const details = `new_24h=${r.new_24h} refresh_24h=${r.refresh_24h} active_24h=${r.active_24h}`;
    const { data: shouldAlert } = await supabase.rpc('record_push_health', {
      p_kind: 'registration', p_unhealthy: !r.healthy, p_value: r.active_24h, p_details: details,
    });
    result.registration = { ...r, alerted: false };
    if (shouldAlert) {
      const html = `
        <div style="font-family:-apple-system,sans-serif;max-width:600px">
          <h2 style="color:#C43D2E;margin:0 0 4px 0">Push REGISTRATION stalled</h2>
          <p>Only <strong>${r.active_24h}</strong> device tokens active in 24h (${details}). Healthy runs ~50 to 175 per day.</p>
          <p>Signature of OneSignal not initializing on-device (empty App ID / SDK not starting) or new-user registration breaking. Check EXPO_PUBLIC_ONESIGNAL_APP_ID + the hardcoded fallback in usePushNotifications.ts and that the latest OTA carries it.</p>
        </div>`.trim();
      (result.registration as any).alerted = await sendAlert(`[ALERT] Push registration stalled: ${r.active_24h} tokens/24h`, html);
    }
  }

  // Check 3: delivery health (OneSignal delivered ratio, last 90 min).
  const { data: del, error: delErr } = await supabase.rpc('push_delivery_health');
  if (delErr) {
    result.deliveryError = delErr.message;
  } else if (del?.[0]) {
    const d = del[0] as { recipients: number; delivered: number; ratio: number | null; evaluated: boolean; healthy: boolean };
    const details = `delivered=${d.delivered}/${d.recipients} ratio=${d.ratio} evaluated=${d.evaluated}`;
    const { data: shouldAlert } = await supabase.rpc('record_push_health', {
      p_kind: 'delivery', p_unhealthy: !d.healthy, p_value: d.delivered, p_details: details,
    });
    result.delivery = { ...d, alerted: false };
    if (shouldAlert) {
      const html = `
        <div style="font-family:-apple-system,sans-serif;max-width:600px">
          <h2 style="color:#C43D2E;margin:0 0 4px 0">Push DELIVERY collapsed</h2>
          <p>OneSignal delivered <strong>${d.delivered}/${d.recipients}</strong> (ratio ${d.ratio}) in the last 90 min, below the 3% floor.</p>
          <p>Steady-state is ~13% (coverage gap). Near-zero with real volume means a transport failure: empty App ID, dead APNs key, or verify_jwt flipped on send-push-notifications.</p>
        </div>`.trim();
      (result.delivery as any).alerted = await sendAlert(`[ALERT] Push delivery collapsed: ${d.delivered}/${d.recipients} in 90min`, html);
    }
  }

  const alerted =
    Boolean((result as any).failuresAlerted) ||
    Boolean((result.registration as any)?.alerted) ||
    Boolean((result.delivery as any)?.alerted);
  return new Response(JSON.stringify({ ok: !alerted, ...result }), { headers: { 'Content-Type': 'application/json' } });
});
