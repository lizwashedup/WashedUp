import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isAuthorizedRunToken } from '../_shared/runTokenAuth.ts';

// Operational tick only. The migration, this function, its dedicated run-token
// and the existing push worker are a paired release dependency. Nothing here
// enables a schedule or the database policy, and this handler calls no provider.
Deno.serve(async (request) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...headers, Allow: 'POST' } });
  }
  if (!isAuthorizedRunToken(request.headers.get('x-run-token'), Deno.env.get('SCENE_REMINDER_RUN_TOKEN'))) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers });
  }
  try {
    const database = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await database.rpc('queue_scene_event_reminders', { p_limit: 500 });
    if (error || !Number.isInteger(data) || data < 0 || data > 500) throw new Error('Unconfirmed reminder queue');
    return new Response(JSON.stringify({ queued: data, providerDeliveryConfirmed: false }), { status: 200, headers });
  } catch {
    // A lost response can follow a committed batch. A later tick safely resumes
    // from durable delivery keys; never claim delivery from a queue receipt.
    console.error('[scene-reminders] scheduling result unconfirmed');
    return new Response(JSON.stringify({ error: 'Reminder scheduling could not be confirmed' }), { status: 503, headers });
  }
});
