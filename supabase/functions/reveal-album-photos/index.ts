import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Called on a cron schedule (daily at 9:00 AM Pacific).
// Reveals developing photos whose reveal_at has passed and sends push
// notifications to eligible event members.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // The DB function handles everything: flips is_developing, inserts notifications.
  // The notification insert trigger then fires send-push-notifications automatically.
  const { error } = await supabase.rpc('reveal_album_photos');

  if (error) {
    console.error('reveal_album_photos failed:', error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
