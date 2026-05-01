import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ONESIGNAL_API_URL = 'https://api.onesignal.com/notifications';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')!;
  const ONESIGNAL_REST_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY')!;

  await supabase.rpc('expire_stale_notifications');

  // Step 1: Get distinct users who have at least one OneSignal subscription.
  // user_id is used as the OneSignal external_id alias (set via OneSignal.login
  // on the client). We don't need the player_ids server-side — OneSignal fans
  // out to every device registered for an external_id automatically.
  const { data: tokenRows, error: tokenError } = await supabase
    .from('device_tokens')
    .select('user_id');

  if (tokenError || !tokenRows?.length) {
    return new Response(JSON.stringify({ sent: 0, total: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const tokenUserIds = [...new Set(tokenRows.map((r) => r.user_id))];

  // Step 2: ATOMICALLY claim pending notifications via the postgres helper.
  //
  // The previous select-then-update pattern was racy. The DB trigger fires
  // this function once per app_notifications insert, so when N rows are
  // inserted close together (e.g. one chat message generating N recipient
  // rows), N parallel function invocations would each SELECT the full
  // unread queue and each call OneSignal with the same rows. Result was 5–8x
  // duplicate push notifications hitting users.
  //
  // claim_pending_push_notifications uses FOR UPDATE SKIP LOCKED so each
  // parallel caller grabs a disjoint set of rows in a single atomic
  // statement, then returns the rows it just marked push_sent=true. Also
  // performs active-chat suppression for new_message notifications where
  // the recipient is currently viewing that chat.
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

  // Send each notification individually to OneSignal. OneSignal's /notifications
  // endpoint takes one (title, body, data, badge) per call, so we can't batch
  // across distinct users like the old Expo flow did. Per-row volume is small
  // enough that this is fine; revisit if rate limits bite.
  //
  // Reliability fix vs. the old Expo flow: if OneSignal returns non-2xx, we
  // revert the claim by setting push_sent=false on those ids. The next
  // app_notifications insert will re-trigger this function and the claim RPC
  // will re-pick up the unsent rows. This converts "permanently lost on Expo
  // 4xx/5xx" into "delayed until the next push." Closes the silent-loss gap.
  let sent = 0;
  const failedIds: string[] = [];

  for (const n of notifications) {
    try {
      const res = await fetch(ONESIGNAL_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Key ${ONESIGNAL_REST_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app_id: ONESIGNAL_APP_ID,
          target_channel: 'push',
          include_aliases: { external_id: [n.user_id] },
          headings: { en: n.title },
          contents: { en: n.body },
          data: { type: n.type, eventId: n.event_id },
          ios_badgeType: 'SetTo',
          ios_badgeCount: badgeCounts[n.user_id] ?? 1,
        }),
      });

      if (res.ok) {
        sent += 1;
      } else {
        failedIds.push(n.id);
      }
    } catch {
      failedIds.push(n.id);
    }
  }

  if (failedIds.length > 0) {
    await supabase
      .from('app_notifications')
      .update({ push_sent: false })
      .in('id', failedIds);
  }

  return new Response(
    JSON.stringify({ sent, total: notifications.length, failed: failedIds.length }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
