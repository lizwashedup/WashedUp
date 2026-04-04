import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');

    // Verify the calling user is authenticated
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    );
    const { data: { user: callerUser }, error: callerError } = await supabaseAuth.auth.getUser(token);
    if (callerError || !callerUser) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Verify caller is an admin
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );
    const { data: adminRow } = await supabaseAdmin
      .from('admin_users')
      .select('user_id')
      .eq('user_id', callerUser.id)
      .maybeSingle();
    if (!adminRow) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { action, targetUserId } = await req.json();
    if (!targetUserId || typeof targetUserId !== 'string') {
      return new Response(
        JSON.stringify({ error: 'targetUserId required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (action === 'delete_and_ban') {
      // Delete all user data in safe order
      await supabaseAdmin.from('messages').delete().eq('user_id', targetUserId);
      await supabaseAdmin.from('event_members').delete().eq('user_id', targetUserId);
      await supabaseAdmin.from('chat_reads').delete().eq('user_id', targetUserId);
      await supabaseAdmin.from('friends').delete().or(`user_id.eq.${targetUserId},friend_id.eq.${targetUserId}`);
      await supabaseAdmin.from('reports').delete().or(`reporter_user_id.eq.${targetUserId},reported_user_id.eq.${targetUserId}`);
      await supabaseAdmin.from('events').delete().eq('creator_user_id', targetUserId);
      await supabaseAdmin.from('profiles').delete().eq('id', targetUserId);

      // Ban the auth record — keeps email "taken" so they can't re-register
      const { error: banError } = await supabaseAdmin.auth.admin.updateUser(targetUserId, {
        ban_duration: '876000h', // ~100 years
      });
      if (banError) {
        console.error('Ban error:', banError);
        return new Response(
          JSON.stringify({ error: banError.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('admin-manage-user error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
