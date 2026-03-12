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

  // Step 2: Fetch pending notifications only for token-having users
  const { data: notifications, error: notifError } = await supabase
    .from('app_notifications')
    .select('id, user_id, type, title, body, event_id')
    .eq('push_sent', false)
    .eq('status', 'unread')
    .in('user_id', tokenUserIds)
    .limit(100);

  if (notifError || !notifications?.length) {
    return new Response(JSON.stringify({ sent: 0, total: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Mark as sent before calling Expo (idempotent: prevents double-send on retry)
  const ids = notifications.map((n: any) => n.id);
  await supabase
    .from('app_notifications')
    .update({ push_sent: true })
    .in('id', ids);

  // Build Expo messages
  const messages = notifications
    .filter((n: any) => tokenMap[n.user_id])
    .map((n: any) => ({
      to: tokenMap[n.user_id],
      title: n.title,
      body: n.body,
      data: { type: n.type, eventId: n.event_id },
      sound: 'default',
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
