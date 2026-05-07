import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const ONE_HOUR_MS = 60 * 60 * 1000;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: userError?.message ?? 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const [eventsRes, membersRes, profileRes] = await Promise.all([
      supabaseAdmin
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('creator_user_id', user.id),
      supabaseAdmin
        .from('event_members')
        .select('event_id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabaseAdmin
        .from('profiles')
        .select('created_at')
        .eq('id', user.id)
        .single(),
    ]);

    if (eventsRes.error || membersRes.error || profileRes.error) {
      console.error('delete-ghost-account safety check error:', {
        events: eventsRes.error,
        members: membersRes.error,
        profile: profileRes.error,
      });
      return new Response(
        JSON.stringify({ error: 'Account has activity, cannot delete' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const eventsCount = eventsRes.count ?? 0;
    const membersCount = membersRes.count ?? 0;
    const profileCreatedAt = profileRes.data?.created_at
      ? new Date(profileRes.data.created_at).getTime()
      : 0;
    const isRecent = profileCreatedAt > 0 && Date.now() - profileCreatedAt < ONE_HOUR_MS;

    if (eventsCount > 0 || membersCount > 0 || !isRecent) {
      return new Response(
        JSON.stringify({ error: 'Account has activity, cannot delete' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error('delete-ghost-account deleteUser error:', deleteError);
      return new Response(
        JSON.stringify({ error: deleteError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('delete-ghost-account error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
