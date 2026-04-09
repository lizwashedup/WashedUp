import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const APP_URL = 'https://washedup.app';
const PLACEHOLDER_IMAGE = `${APP_URL}/assets/images/plan-placeholder.png`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const fallback = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${APP_URL}"></head><body>Redirecting...</body></html>`;

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    if (!code) {
      return new Response(fallback, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );

    const { data: moment, error } = await supabase
      .from('plan_moments')
      .select('id, content, event_id, user_id, created_at')
      .eq('id', code)
      .single();

    if (error || !moment) {
      return new Response(fallback, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Fetch plan + writer info
    const [eventRes, profileRes] = await Promise.all([
      supabase.from('events').select('id, title, start_time, image_url').eq('id', moment.event_id).single(),
      supabase.from('profiles').select('first_name_display, profile_photo_url').eq('id', moment.user_id).single(),
    ]);

    const event = eventRes.data;
    const profile = profileRes.data;

    const writerName = profile?.first_name_display?.split(' ')[0] ?? 'Someone';
    const planTitle = event?.title ?? 'a plan';
    const planDate = event?.start_time ? formatDate(event.start_time) : '';
    const momentText = moment.content.length > 160
      ? moment.content.slice(0, 157) + '...'
      : moment.content;

    const title = escapeHtml(`${writerName} on ${planTitle}`);
    const description = escapeHtml(`"${momentText}"${planDate ? ` — ${planDate}` : ''}`);
    const imageUrl = (profile?.profile_photo_url || event?.image_url || PLACEHOLDER_IMAGE);
    const deepLink = `washedupapp://plan/${moment.event_id}`;
    const canonicalUrl = `${APP_URL}/m/${moment.id}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — WashedUp</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="WashedUp">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}">
  <meta http-equiv="refresh" content="0;url=${deepLink}">
  <link rel="canonical" href="${canonicalUrl}">
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 480px; margin: 40px auto; padding: 20px; background: #FAF5EC; color: #2C1810; }
    .card { background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 2px 12px rgba(44,24,16,0.06); }
    .moment { font-style: italic; font-size: 18px; line-height: 1.5; margin: 16px 0; color: #2C1810; }
    .meta { color: #78695C; font-size: 14px; }
    .cta { display: inline-block; background: #B5522E; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 999px; font-weight: 600; margin-top: 20px; }
    .cta:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="card">
    <p class="meta">${escapeHtml(writerName)} on <strong>${escapeHtml(planTitle)}</strong>${planDate ? ` · ${escapeHtml(planDate)}` : ''}</p>
    <p class="moment">"${escapeHtml(moment.content)}"</p>
    <a class="cta" href="https://washedup.app">Join WashedUp</a>
  </div>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    });
  } catch (err) {
    console.error('og-moment error:', err);
    return new Response(fallback, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
});
