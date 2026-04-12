import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  await supabase.rpc('expire_stale_notifications');

  // Step 1: Get all users who have push tokens
  const { data: tokenProfiles, error: tokenError } = await supabase
    .from('profiles')
    .select('id, expo_push_token')
    .not('expo_push_token', 'is', null);

  if (tokenError || !tokenProfiles?.length) {
    return new Response(JSON.stringify({ sent: 0, total: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const tokenMap: Record<string, string> = {};
  const tokenUserIds: string[] = [];
  for (const p of tokenProfiles) {
    tokenMap[p.id] = p.expo_push_token;
    tokenUserIds.push(p.id);
  }

  // Step 2: ATOMICALLY claim pending notifications via the postgres helper.
  //
  // The previous select-then-update pattern was racy. The DB trigger fires
  // this function once per app_notifications insert, so when N rows are
  // inserted close together (e.g. one chat message generating N recipient
  // rows), N parallel function invocations would each SELECT the full
  // unread queue and each call Expo with the same rows. Result was 5–8x
  // duplicate push notifications hitting users.
  //
  // claim_pending_push_notifications uses FOR UPDATE SKIP LOCKED so each
  // parallel caller grabs a disjoint set of rows in a single atomic
  // statement, then returns the rows it just marked push_sent=true.
  const { data: claimedRows, error: claimError } = await supabase.rpc(
    'claim_pending_push_notifications',
    { p_token_user_ids: tokenUserIds, p_batch_size: 100 },
  );

  if (claimError) {
    return new Response(
      JSON.stringify({ sent: 0, total: 0, error: claimError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const notifications = claimedRows ?? [];
  if (notifications.length === 0) {
    return new Response(JSON.stringify({ sent: 0, total: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Compute per-user badge counts via the postgres helper. The helper returns
  // distinct unread chats + inbox-visible app_notifications + pending plan
  // invites — i.e. what the user actually sees in the in-app UI — instead of
  // raw count(*) on app_notifications which would inflate the badge by every
  // new_message row from chats the user has never opened.
  const affectedUserIds = [...new Set(notifications.map((n: any) => n.user_id))];
  const { data: badgeRows, error: badgeError } = await supabase.rpc(
    'compute_user_badge_counts',
    { p_user_ids: affectedUserIds },
  );

  const badgeCounts: Record<string, number> = {};
  if (!badgeError) {
    for (const row of badgeRows ?? []) {
      badgeCounts[row.user_id] = row.badge ?? 0;
    }
  }

  // Build Expo messages
  const messages = notifications
    .filter((n: any) => tokenMap[n.user_id])
    .map((n: any) => ({
      to: tokenMap[n.user_id],
      title: n.title,
      body: n.body,
      data: { type: n.type, eventId: n.event_id },
      sound: 'default',
      badge: badgeCounts[n.user_id] ?? 1,
    }));

  if (messages.length === 0) {
    return new Response(JSON.stringify({ sent: 0, total: notifications.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Send in batches of 100
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (res.ok) sent += batch.length;
  }

  return new Response(JSON.stringify({ sent, total: notifications.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
