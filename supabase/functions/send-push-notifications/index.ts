import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 200; // Max UUIDs per .in() call
const BATCH_SIZE = 100; // Expo push API batch size

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  await supabase.rpc('expire_stale_notifications');

  // Step 1: Get all users who have push tokens (chunked if needed)
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

  // Step 2: Fetch ALL pending notifications (chunked .in() for scale)
  let allNotifications: any[] = [];
  for (const userChunk of chunk(tokenUserIds, CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('app_notifications')
      .select('id, user_id, type, title, body, event_id')
      .eq('push_sent', false)
      .eq('status', 'unread')
      .in('user_id', userChunk);

    if (!error && data) allNotifications = allNotifications.concat(data);
  }

  if (allNotifications.length === 0) {
    return new Response(JSON.stringify({ sent: 0, total: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Step 3: Count unread notifications per user for badge (efficient grouped count)
  const affectedUserIds = [...new Set(allNotifications.map((n: any) => n.user_id))];
  const badgeCounts: Record<string, number> = {};
  for (const userChunk of chunk(affectedUserIds, CHUNK_SIZE)) {
    const { data: unreadRows } = await supabase
      .from('app_notifications')
      .select('user_id')
      .eq('status', 'unread')
      .in('user_id', userChunk);

    for (const row of unreadRows ?? []) {
      badgeCounts[row.user_id] = (badgeCounts[row.user_id] || 0) + 1;
    }
  }

  // Step 4: Build and send in batches — mark as sent AFTER successful Expo response
  const messages = allNotifications
    .filter((n: any) => tokenMap[n.user_id])
    .map((n: any) => ({
      _notifId: n.id,
      to: tokenMap[n.user_id],
      title: n.title,
      body: n.body,
      data: { type: n.type, eventId: n.event_id },
      sound: 'default',
      badge: badgeCounts[n.user_id] ?? 1,
    }));

  if (messages.length === 0) {
    return new Response(JSON.stringify({ sent: 0, total: allNotifications.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let sent = 0;
  for (const batch of chunk(messages, BATCH_SIZE)) {
    const expoBatch = batch.map(({ _notifId, ...rest }) => rest);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expoBatch),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        // Mark as sent only after successful delivery to Expo
        const sentIds = batch.map(m => m._notifId);
        await supabase
          .from('app_notifications')
          .update({ push_sent: true })
          .in('id', sentIds);
        sent += batch.length;
      }
    } catch {
      // Expo API failed for this batch — notifications stay push_sent=false for retry
    }
  }

  return new Response(JSON.stringify({ sent, total: allNotifications.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
