import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// sync-push-subscription-state
// -----------------------------------------------------------------------------
// Reads each device's TRUE reachability from OneSignal and writes it back to
// device_tokens (push_enabled, notification_types, enabled_synced_at). Our DB
// otherwise has no idea who can actually receive a push: profiles.push_* flags
// are default-true and only OneSignal knows if the OS-level permission is on.
//
// Why this exists: a 2026-07 winback send to ~175 opted-in June users delivered
// to only 58 — the rest had notifications disabled at the OS level (OneSignal
// subscription enabled=false, notification_types 0 or -18), which OneSignal
// rejects as "invalid_player_ids". This job makes that state queryable so we can
// measure real reach, target only reachable users, and drive a re-permission
// prompt later.
//
// This NEVER sends a push and NEVER mutates OneSignal. It is read-from-OneSignal,
// write-to-our-DB only. It does not touch app_notifications or send-push-*.
//
// Scheduled every 30 min via pg_cron (headerless net.http_post, same as
// monitor-push-health). Stays verify_jwt=false — it carries no user JWT; it uses
// the service role from env. ALWAYS deploy with --no-verify-jwt.
//
// Incremental by design: each run refreshes the BATCH_USERS stalest users
// (enabled_synced_at null or older than STALE_HOURS), so the whole base cycles
// every few hours without a bulk export. Enabled-state changes slowly, so that
// freshness is ample.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')!;
const ONESIGNAL_REST_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY')!;

const ONESIGNAL_BASE = 'https://api.onesignal.com';
const BATCH_USERS = 150;      // distinct users refreshed per run
const STALE_HOURS = 6;        // re-sync a token this old
const CONCURRENCY = 8;        // parallel OneSignal reads (well under rate limit)
const FETCH_TIMEOUT_MS = 10_000;

type TokenRow = { onesignal_player_id: string; user_id: string };
type OneSignalSub = { id: string; enabled?: boolean; notification_types?: number };

async function fetchUserSubs(externalId: string): Promise<
  { ok: true; subs: OneSignalSub[] } | { ok: 'notfound' } | { ok: false }
> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${ONESIGNAL_BASE}/apps/${ONESIGNAL_APP_ID}/users/by/external_id/${externalId}`,
      { headers: { Authorization: `Key ${ONESIGNAL_REST_API_KEY}` }, signal: ctrl.signal },
    );
    if (res.status === 404) return { ok: 'notfound' };
    if (!res.ok) return { ok: false };
    const body = await res.json();
    return { ok: true, subs: Array.isArray(body?.subscriptions) ? body.subscriptions : [] };
  } catch (_e) {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Pull the stalest tokens (null enabled_synced_at sorts first). Group by user
  // so one OneSignal read updates every device that user owns.
  const staleCutoff = new Date(Date.now() - STALE_HOURS * 3600_000).toISOString();
  const { data: rows, error: selErr } = await supabase
    .from('device_tokens')
    .select('onesignal_player_id, user_id, enabled_synced_at')
    .not('onesignal_player_id', 'is', null)
    .or(`enabled_synced_at.is.null,enabled_synced_at.lt.${staleCutoff}`)
    .order('enabled_synced_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_USERS * 3); // headroom: several tokens per user

  if (selErr) {
    return new Response(JSON.stringify({ ok: false, stage: 'select', error: selErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Distinct users, capped at BATCH_USERS, preserving stale-first order.
  const tokensByUser = new Map<string, TokenRow[]>();
  for (const r of (rows ?? []) as TokenRow[]) {
    if (!tokensByUser.has(r.user_id)) {
      if (tokensByUser.size >= BATCH_USERS) continue;
      tokensByUser.set(r.user_id, []);
    }
    tokensByUser.get(r.user_id)!.push(r);
  }

  const users = [...tokensByUser.keys()];
  let enabledCount = 0, disabledCount = 0, notFound = 0, apiErrors = 0, tokensWritten = 0;

  // Bounded-concurrency worker pool.
  let cursor = 0;
  async function worker() {
    while (cursor < users.length) {
      const userId = users[cursor++];
      const tokens = tokensByUser.get(userId)!;
      const result = await fetchUserSubs(userId);

      if (result.ok === false) { apiErrors++; continue; } // leave for next run

      // Map subscription id -> state (empty on 404: OneSignal knows no devices).
      const subMap = new Map<string, OneSignalSub>();
      if (result.ok === true) {
        for (const s of result.subs) if (s?.id) subMap.set(s.id, s);
      } else {
        notFound++;
      }

      const nowIso = new Date().toISOString();
      for (const t of tokens) {
        const sub = subMap.get(t.onesignal_player_id);
        // Present with enabled:true => reachable. Absent, or present but
        // disabled => unreachable. Either way we got an authoritative answer.
        const enabled = sub?.enabled === true;
        const ntypes = typeof sub?.notification_types === 'number' ? sub.notification_types : null;
        const { error: upErr } = await supabase
          .from('device_tokens')
          .update({ push_enabled: enabled, notification_types: ntypes, enabled_synced_at: nowIso })
          .eq('onesignal_player_id', t.onesignal_player_id);
        if (upErr) { apiErrors++; continue; }
        tokensWritten++;
        if (enabled) enabledCount++; else disabledCount++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, users.length) }, worker));

  return new Response(
    JSON.stringify({
      ok: true,
      users_processed: users.length,
      tokens_written: tokensWritten,
      enabled: enabledCount,
      disabled: disabledCount,
      onesignal_not_found: notFound,
      api_errors: apiErrors,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
