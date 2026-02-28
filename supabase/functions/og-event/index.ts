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
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    // Share URLs: washedup.app/e/{eventId} — eventId is the events.id UUID
    // Vercel rewrite passes ?code=:code, so we read 'code' param
    const code = url.searchParams.get('code');
    if (!code) {
      return new Response(
        `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${APP_URL}"></head><body>Redirecting...</body></html>`,
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/html; charset=utf-8',
          },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Query by events.id (UUID) — matches what PlanCard, SharePlanModal, plan detail, event detail put in the URL
    const { data: event, error } = await supabase
      .from('events')
      .select('id, title, description, image_url, start_time, location_text')
      .eq('id', code)
      .single();

    if (error || !event) {
      return new Response(
        `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${APP_URL}"></head><body>Redirecting...</body></html>`,
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/html; charset=utf-8',
          },
        }
      );
    }

    const title = escapeHtml(event.title || 'Plan on WashedUp');
    const rawImageUrl = event.image_url && event.image_url.startsWith('http')
      ? event.image_url
      : PLACEHOLDER_IMAGE;
    // Cache-bust per plan so iMessage/crawlers don't serve stale previews
    const imageUrl = rawImageUrl.includes('?') ? `${rawImageUrl}&v=${event.id}` : `${rawImageUrl}?v=${event.id}`;
    const descParts: string[] = [];
    if (event.start_time) descParts.push(formatDate(event.start_time));
    if (event.location_text) descParts.push(event.location_text);
    if (event.description) descParts.push(event.description.slice(0, 100) + (event.description.length > 100 ? '...' : ''));
    const description = escapeHtml(descParts.length > 0 ? descParts.join(' · ') : 'Find people to go with in LA.');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:url" content="${APP_URL}/e/${event.id}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="WashedUp">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${imageUrl}">
  <meta http-equiv="refresh" content="0;url=washedupapp://plan/${event.id}">
  <link rel="canonical" href="${APP_URL}/e/${event.id}">
</head>
<body>
  <p>Redirecting to <a href="washedupapp://plan/${event.id}">open in WashedUp</a>...</p>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (err) {
    console.error('og-event error:', err);
    return new Response(
      `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${APP_URL}"></head><body>Redirecting...</body></html>`,
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html; charset=utf-8',
        },
      }
    );
  }
});
