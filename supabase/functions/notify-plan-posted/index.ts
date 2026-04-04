import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const PLAN_ALERT_EMAIL = 'liz@washedup.app';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface PlanPayload {
  record: {
    id: string;
    title: string;
    description: string | null;
    host_message: string | null;
    location_text: string | null;
    primary_vibe: string | null;
    gender_rule: string | null;
    max_invites: number | null;
    creator_user_id: string;
    created_at: string;
    status: string;
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  try {
    const payload: PlanPayload = await req.json();
    const plan = payload.record;
    if (!plan?.id) {
      return new Response(JSON.stringify({ error: 'No plan data' }), { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Fetch creator profile
    const { data: creator } = await supabase
      .from('profiles')
      .select('first_name_display, city, email')
      .eq('id', plan.creator_user_id)
      .single();

    const creatorName = creator?.first_name_display ?? 'Unknown';
    const creatorCity = creator?.city ?? '';
    const planLink = `https://washedup.app/plan/${plan.id}`;
    const postedAt = new Date(plan.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

    // ── 1. Send email to liz@washedup.app ──────────────────────────────────────
    const html = `
      <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #B5522E; margin-bottom: 4px;">New Plan Posted</h2>
        <p style="color: #999; font-size: 13px; margin-top: 0;">${postedAt} PT</p>

        <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
          <tr><td style="padding: 8px 0; color: #666; width: 140px;">Title</td><td style="padding: 8px 0; font-weight: 600;">${plan.title}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Posted by</td><td style="padding: 8px 0;">${creatorName}${creatorCity ? ` · ${creatorCity}` : ''}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Creator ID</td><td style="padding: 8px 0; font-family: monospace; font-size: 12px;">${plan.creator_user_id}</td></tr>
          ${plan.location_text ? `<tr><td style="padding: 8px 0; color: #666;">Location</td><td style="padding: 8px 0;">${plan.location_text}</td></tr>` : ''}
          ${plan.primary_vibe ? `<tr><td style="padding: 8px 0; color: #666;">Category</td><td style="padding: 8px 0; text-transform: capitalize;">${plan.primary_vibe}</td></tr>` : ''}
          ${plan.gender_rule ? `<tr><td style="padding: 8px 0; color: #666;">Gender rule</td><td style="padding: 8px 0;">${plan.gender_rule}</td></tr>` : ''}
          ${plan.max_invites ? `<tr><td style="padding: 8px 0; color: #666;">Group size</td><td style="padding: 8px 0;">${plan.max_invites} people</td></tr>` : ''}
          ${plan.description ? `<tr><td style="padding: 8px 0; color: #666; vertical-align: top;">Description</td><td style="padding: 8px 0;">${plan.description}</td></tr>` : ''}
          ${plan.host_message ? `<tr><td style="padding: 8px 0; color: #666; vertical-align: top;">Creator note</td><td style="padding: 8px 0; font-style: italic;">"${plan.host_message}"</td></tr>` : ''}
          <tr><td style="padding: 8px 0; color: #666;">Link</td><td style="padding: 8px 0;"><a href="${planLink}" style="color: #B5522E;">${planLink}</a></td></tr>
        </table>
      </div>
    `.trim();

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'WashedUp Plans <plans@washedup.app>',
        to: [PLAN_ALERT_EMAIL],
        subject: `[WashedUp] New plan: "${plan.title}" by ${creatorName}`,
        html,
      }),
    });

    // ── 2. Push notification to admin devices ──────────────────────────────────
    const { data: adminRows } = await supabase
      .from('admin_users')
      .select('user_id');

    if (adminRows && adminRows.length > 0) {
      const adminIds = adminRows.map((r: { user_id: string }) => r.user_id);
      const { data: adminProfiles } = await supabase
        .from('profiles')
        .select('expo_push_token')
        .in('id', adminIds)
        .not('expo_push_token', 'is', null);

      const tokens = (adminProfiles ?? [])
        .map((p: { expo_push_token: string | null }) => p.expo_push_token)
        .filter(Boolean) as string[];

      if (tokens.length > 0) {
        const messages = tokens.map((token) => ({
          to: token,
          title: '📋 New plan posted',
          body: `"${plan.title}" by ${creatorName}`,
          data: { planId: plan.id, type: 'admin_plan_alert' },
          sound: 'default',
        }));

        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messages),
        });
      }
    }

    const emailBody = await emailRes.json();
    return new Response(JSON.stringify({ sent: emailRes.ok, resend: emailBody }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
