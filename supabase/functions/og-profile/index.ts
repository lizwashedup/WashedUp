import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const APP_URL = 'https://washedup.app';
// /assets/images/plan-placeholder.png 404s on the webapp — broke every
// share preview that fell back to this. /og-image.png is served.
const PLACEHOLDER_IMAGE = `${APP_URL}/og-image.png`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const handle = url.searchParams.get('handle');
    if (!handle) {
      return new Response(
        `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${APP_URL}"></head><body>Redirecting...</body></html>`,
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('first_name_display, profile_photo_url, handle')
      .eq('handle', handle)
      .single();

    if (error || !profile) {
      return new Response(
        `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${APP_URL}"></head><body>Redirecting...</body></html>`,
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
        }
      );
    }

    const name = escapeHtml(profile.first_name_display || handle);
    const imageUrl =
      profile.profile_photo_url && profile.profile_photo_url.startsWith('http')
        ? profile.profile_photo_url
        : PLACEHOLDER_IMAGE;
    const description = escapeHtml(`Join ${name} on WashedUp — find people to do things with in LA.`);
    const deepLink = `washedupapp://u/${encodeURIComponent(handle)}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name} on WashedUp</title>
  <meta property="og:title" content="${name} on WashedUp">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:url" content="${APP_URL}/u/${escapeHtml(handle)}">
  <meta property="og:type" content="profile">
  <meta property="og:site_name" content="WashedUp">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${name} on WashedUp">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${imageUrl}">
  <meta http-equiv="refresh" content="0;url=${deepLink}">
  <link rel="canonical" href="${APP_URL}/u/${escapeHtml(handle)}">
</head>
<body>
  <p>Redirecting to <a href="${deepLink}">open ${name}'s profile in WashedUp</a>...</p>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    console.error('og-profile error:', err);
    return new Response(
      `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${APP_URL}"></head><body>Redirecting...</body></html>`,
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      }
    );
  }
});
