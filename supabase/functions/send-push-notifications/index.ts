import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1. Expire stale notifications first
  await supabase.rpc('expire_stale_notifications');

  // 2. Find unsent notifications
  const { data: notifications } = await supabase
    .from('app_notifications')
    .select('id, user_id, type, title, body, event_id')
    .eq('push_sent', false)
    .eq('status', 'unread')
    .limit(100);

  if (!notifications?.length) {
    return new Response(JSON.stringify({ sent: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 3. Find unsent plan invites
  const { data: invites } = await supabase
    .from('plan_invites')
    .select(`
      id, recipient_id, event_id,
      events (title),
      profiles!plan_invites_sender_id_fkey (first_name_display)
    `)
    .eq('status', 'pending');

  // 4. Get push tokens for all relevant users
  const userIds = [
    ...new Set([
      ...notifications.map((n: any) => n.user_id),
      ...(invites ?? []).map((i: any) => i.recipient_id),
    ]),
  ];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, expo_push_token')
    .in('id', userIds)
    .not('expo_push_token', 'is', null);

  const tokenMap = new Map(
    (profiles ?? []).map((p: any) => [p.id, p.expo_push_token]),
  );

  // 5. Build push messages
  const messages: PushMessage[] = [];
  const notifIdsToMark: string[] = [];

  for (const notif of notifications) {
    const token = tokenMap.get(notif.user_id);
    if (!token) continue;

    messages.push({
      to: token,
      title: notif.title,
      body: notif.body ?? '',
      data: notif.event_id ? { eventId: notif.event_id, type: notif.type } : { type: notif.type },
      sound: 'default',
    });
    notifIdsToMark.push(notif.id);
  }

  // 6. Send to Expo Push API in batches of 100
  let totalSent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      if (res.ok) totalSent += batch.length;
    } catch (err) {
      console.error('Push batch failed:', err);
    }
  }

  // 7. Mark notifications as push_sent
  if (notifIdsToMark.length > 0) {
    await supabase
      .from('app_notifications')
      .update({ push_sent: true })
      .in('id', notifIdsToMark);
  }

  return new Response(
    JSON.stringify({ sent: totalSent, total: messages.length }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
