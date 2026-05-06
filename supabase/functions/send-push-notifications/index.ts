import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Dual-send fanout: per-recipient routing between OneSignal and Expo Push.
//
// During the OneSignal cutover window we have two populations of users:
//   * 1.0.4+ users: registered a OneSignal player ID (row in device_tokens).
//   * 1.0.3 holdouts: still have profiles.expo_push_token, no OneSignal.
//
// We send to each user via whichever transport they have. Once 1.0.4
// adoption is high enough, the Expo branch can be deleted and this
// function reduces back to OneSignal-only.

const ONESIGNAL_API_URL = 'https://api.onesignal.com/notifications';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

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

  // Step 1: Discover both transport populations.
  // OneSignal-capable: any user_id present in device_tokens.
  const { data: osRows, error: osErr } = await supabase
    .from('device_tokens')
    .select('user_id');
  if (osErr) {
    console.warn('[send-push] device_tokens read failed:', osErr.message);
  }
  const oneSignalUserIds = new Set<string>(
    ((osRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
  );

  // Expo-capable: any profile with a non-null expo_push_token.
  const { data: expoRows, error: expoErr } = await supabase
    .from('profiles')
    .select('id, expo_push_token')
    .not('expo_push_token', 'is', null);
  if (expoErr) {
    console.warn('[send-push] profiles read failed:', expoErr.message);
  }
  const expoTokenByUser = new Map<string, string>();
  for (const p of (expoRows ?? []) as Array<{ id: string; expo_push_token: string | null }>) {
    if (p.expo_push_token) expoTokenByUser.set(p.id, p.expo_push_token);
  }

  // Union for the claim. claim_pending_push_notifications only returns rows
  // whose user_id is in this set, so users with no transport are left alone
  // and will be picked up the next time they register.
  const allEligibleUserIds = [
    ...new Set<string>([...oneSignalUserIds, ...expoTokenByUser.keys()]),
  ];

  if (allEligibleUserIds.length === 0) {
    return new Response(JSON.stringify({ sent: 0, total: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Step 2: ATOMICALLY claim pending notifications via the postgres helper.
  //
  // The previous select-then-update pattern was racy. The DB trigger fires
  // this function once per app_notifications insert, so when N rows are
  // inserted close together (e.g. one chat message generating N recipient
  // rows), N parallel function invocations would each SELECT the full
  // unread queue and each call out with the same rows. Result was 5–8x
  // duplicate push notifications hitting users.
  //
  // claim_pending_push_notifications uses FOR UPDATE SKIP LOCKED so each
  // parallel caller grabs a disjoint set of rows in a single atomic
  // statement, then returns the rows it just marked push_sent=true. Also
  // performs active-chat suppression for new_message notifications where
  // the recipient is currently viewing that chat.
  const { data: claimedRows, error: claimError } = await supabase.rpc(
    'claim_pending_push_notifications',
    { p_token_user_ids: allEligibleUserIds, p_batch_size: 100 },
  );

  if (claimError) {
    return new Response(
      JSON.stringify({ sent: 0, total: 0, error: claimError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const notifications = (claimedRows ?? []) as Array<{
    id: string;
    user_id: string;
    type: string;
    title: string;
    body: string | null;
    event_id: string | null;
  }>;

  if (notifications.length === 0) {
    return new Response(JSON.stringify({ sent: 0, total: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Step 3: Per-user badge counts (transport-agnostic).
  const affectedUserIds = [...new Set(notifications.map((n) => n.user_id))];
  const { data: badgeRows, error: badgeError } = await supabase.rpc(
    'compute_user_badge_counts',
    { p_user_ids: affectedUserIds },
  );

  const badgeCounts: Record<string, number> = {};
  if (!badgeError) {
    for (const row of (badgeRows ?? []) as Array<{ user_id: string; badge: number | null }>) {
      badgeCounts[row.user_id] = row.badge ?? 0;
    }
  }

  // Step 4: Route each claimed notification to OneSignal or Expo.
  // OneSignal wins when a user has both (1.0.4 user upgrading from 1.0.3).
  const oneSignalQueue: typeof notifications = [];
  const expoQueue: typeof notifications = [];
  for (const n of notifications) {
    if (oneSignalUserIds.has(n.user_id)) {
      oneSignalQueue.push(n);
    } else if (expoTokenByUser.has(n.user_id)) {
      expoQueue.push(n);
    }
    // else: user lost their transport between the lookup and the claim;
    // the notification stays push_sent=true silently. Edge case, not worth
    // a revert (next inserts retrigger and the row will be re-eligible).
  }

  let oneSignalSent = 0;
  let expoSent = 0;
  const failedIds: string[] = [];

  // Step 5a: OneSignal send. Per-row POST. Reverts claim on non-2xx so the
  // next trigger picks the row up again.
  for (const n of oneSignalQueue) {
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
        oneSignalSent += 1;
      } else {
        failedIds.push(n.id);
      }
    } catch {
      failedIds.push(n.id);
    }
  }

  // Step 5b: Expo Push send (batches of 100). Tracks ticket IDs for the
  // post-send receipt sweep that catches DeviceNotRegistered errors and
  // nulls the stale token on profiles. Behavior preserved from deployed v13.
  type ExpoMessage = {
    to: string;
    title: string;
    body: string | null;
    data: { type: string; eventId: string | null };
    sound: string;
    badge: number;
  };
  const expoMessages: ExpoMessage[] = [];
  const expoUserIdByIndex: string[] = [];
  const expoNotifIdByIndex: string[] = [];
  for (const n of expoQueue) {
    const token = expoTokenByUser.get(n.user_id);
    if (!token) continue;
    expoMessages.push({
      to: token,
      title: n.title,
      body: n.body,
      data: { type: n.type, eventId: n.event_id },
      sound: 'default',
      badge: badgeCounts[n.user_id] ?? 1,
    });
    expoUserIdByIndex.push(n.user_id);
    expoNotifIdByIndex.push(n.id);
  }

  type ExpoTicket = { ticketId: string; userId: string; notificationId: string };
  const expoTickets: ExpoTicket[] = [];

  for (let i = 0; i < expoMessages.length; i += 100) {
    const batch = expoMessages.slice(i, i + 100);
    const batchUserIds = expoUserIdByIndex.slice(i, i + 100);
    const batchNotifIds = expoNotifIdByIndex.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      if (res.ok) {
        const result = await res.json();
        const tickets = (result.data ?? []) as Array<
          { status: 'ok'; id: string } | { status: 'error'; details?: { error?: string } }
        >;
        for (let j = 0; j < tickets.length; j++) {
          const ticket = tickets[j];
          if (ticket.status === 'ok' && 'id' in ticket && ticket.id) {
            expoSent += 1;
            expoTickets.push({
              ticketId: ticket.id,
              userId: batchUserIds[j],
              notificationId: batchNotifIds[j],
            });
          } else if (ticket.status === 'error') {
            failedIds.push(batchNotifIds[j]);
            if (ticket.details?.error === 'DeviceNotRegistered') {
              await supabase
                .from('profiles')
                .update({ expo_push_token: null })
                .eq('id', batchUserIds[j]);
              console.log(
                `[send-push] cleared stale token for ${batchUserIds[j]} (DeviceNotRegistered on send)`,
              );
            }
          }
        }
      } else {
        for (const id of batchNotifIds) failedIds.push(id);
      }
    } catch (err) {
      console.error('[send-push] Expo send error:', err);
      for (const id of batchNotifIds) failedIds.push(id);
    }
  }

  // Step 5c: Expo receipt sweep. Wait briefly for receipts to be available,
  // then POST batches of 300 ticket IDs. Any ticket with status=error and
  // details.error=DeviceNotRegistered means that device has unregistered
  // since the send; null its expo_push_token so it stops getting tries.
  if (expoTickets.length > 0) {
    await new Promise((r) => setTimeout(r, 5000));
    for (let i = 0; i < expoTickets.length; i += 300) {
      const batch = expoTickets.slice(i, i + 300);
      const ticketIds = batch.map((t) => t.ticketId);
      const ticketUserMap: Record<string, string> = {};
      for (const t of batch) ticketUserMap[t.ticketId] = t.userId;
      try {
        const receiptRes = await fetch(EXPO_RECEIPTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: ticketIds }),
        });
        if (receiptRes.ok) {
          const receiptResult = await receiptRes.json();
          const receipts = receiptResult.data ?? {};
          for (const [ticketId, receipt] of Object.entries(receipts)) {
            const r = receipt as { status?: string; details?: { error?: string } };
            if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') {
              const userId = ticketUserMap[ticketId];
              if (userId) {
                await supabase
                  .from('profiles')
                  .update({ expo_push_token: null })
                  .eq('id', userId);
                console.log(
                  `[send-push] cleared stale token for ${userId} (DeviceNotRegistered on receipt)`,
                );
              }
            }
          }
        }
      } catch (err) {
        console.error('[send-push] Expo receipt check error:', err);
      }
    }
  }

  // Step 6: Revert claims for hard failures (mirrors the OneSignal-only
  // version's revert behavior; converts "permanently lost" into "delayed").
  if (failedIds.length > 0) {
    await supabase
      .from('app_notifications')
      .update({ push_sent: false })
      .in('id', failedIds);
  }

  return new Response(
    JSON.stringify({
      sent: oneSignalSent + expoSent,
      total: notifications.length,
      oneSignalSent,
      expoSent,
      failed: failedIds.length,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
