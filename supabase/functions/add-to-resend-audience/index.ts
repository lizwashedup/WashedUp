// add-to-resend-audience: registers the caller (an authenticated user) with
// the WashedUp Resend audience so they get future "plans/events near you"
// emails. Called by app/(auth)/onboarding/basics.tsx after the user submits
// step 1 with marketing_opt_in checked AND an email provided.
//
// Behavior:
//   - 401 if no JWT.
//   - Reads profiles for the caller (service-role client; RLS bypass needed
//     because we trust the JWT-derived auth.uid() but the function may be
//     called before profiles RLS is set up for the row).
//   - Skip-200 if marketing_opt_in is false OR email is null/empty. The
//     client doesn't need to know whether the call ran — the column is the
//     source of truth.
//   - POST https://api.resend.com/audiences/{AUDIENCE_ID}/contacts. Resend's
//     contacts API is upsert-by-email so retry/duplication is safe.
//   - Logs Resend non-2xx but still returns 200 to the client. Marketing
//     fanout failure shouldn't block the onboarding flow; the column is
//     persisted so a future settings-page sync can pick it up.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// WashedUp main audience. Single audience for now — if we ever add more
// (e.g. region-specific, event-type-specific), promote to env var or pass
// as a request param.
const AUDIENCE_ID = '1e1ba2a2-ae9a-4df9-9396-16a23e06c891';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Service-role read so we don't depend on profiles RLS (which restricts
    // even self-reads in some setups).
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile, error: profileErr } = await adminClient
      .from('profiles')
      .select('email, first_name_display, last_name, marketing_opt_in')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile) {
      return new Response(JSON.stringify({ error: 'profile not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const email = (profile.email ?? '').trim();
    if (!profile.marketing_opt_in || !email) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const resendRes = await fetch(
      `https://api.resend.com/audiences/${AUDIENCE_ID}/contacts`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          first_name: profile.first_name_display ?? '',
          last_name: profile.last_name ?? '',
          unsubscribed: false,
        }),
      },
    );

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error(
        '[add-to-resend-audience] Resend API non-2xx:',
        resendRes.status,
        errText,
      );
      // Still return 200 — client treats this as fire-and-forget.
      return new Response(
        JSON.stringify({ ok: false, status: resendRes.status, error: errText }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const body = await resendRes.json().catch(() => ({}));
    return new Response(JSON.stringify({ ok: true, resend: body }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[add-to-resend-audience] unexpected:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
