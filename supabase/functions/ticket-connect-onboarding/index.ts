import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
/**
 * ticket-connect-onboarding — Express onboarding entry (ticketing lane,
 * 2026-07-21, Cowork's sprint order on Liz's word; notes folded same day
 * per Cowork's approved-with-notes verdict).
 *
 * WHAT IT DOES, and ALL it does: for an APPROVED organizer (event_host or
 * community_leader grant — both tracks sell, Cowork's 7-20 ruling), create
 * their Stripe Express connected account if none exists (doc 61 §2 target
 * config: platform pays fees and carries losses, Stripe collects
 * requirements, express dashboard, MANUAL payout schedule — lean 3), record
 * it in organizer_stripe_accounts with the commission lock, and return a
 * fresh account-onboarding link.
 *
 * KEY RULING (Liz, 7-21, relayed by Cowork): LIVE-MODE KEYS FOR ONBOARDING
 * ONLY. This function reads its OWN secret, STRIPE_CONNECT_ONBOARDING_KEY,
 * which MAY be sk_live so real founding partners onboard real accounts
 * today. The charge functions keep their separate STRIPE_SECRET_KEY behind
 * the stripeKeyIsTest guard until Liz's walk. SEPARATION IS THE SAFETY:
 * this function calls exactly two Stripe endpoints — /v1/accounts and
 * /v1/account_links — and contains no charge, payment-intent, transfer, or
 * payout call of any kind. It cannot move money with any key.
 *
 * THE 7-21 NOTES, folded: (1) the concurrent-create race heals — a
 * unique-violation on the lock-row insert re-selects the winner's row and
 * continues to the link step (the loser's just-created Stripe account is
 * an INERT ORPHAN: no row, no charges ever route to it; accepted by the
 * verdict); (2) OPTIONS/CORS for the web app's cross-origin call; (3) the
 * commission constant is FOUNDING_PARTNER_BPS by name — every approved
 * grant today is a founding partner, a non-founding rate is a REVIEWED
 * change, and the per-organizer lock in organizer_stripe_accounts is what
 * actually governs at checkout (the constant only seeds new rows).
 *
 * Auth: end-user JWT (verify_jwt on). The grant check and every DB write
 * run through the service client; the caller's identity comes only from
 * their verified token.
 */ const STRIPE_API = 'https://api.stripe.com/v1';
const RETURN_URL = 'https://washedup.app/creator/payouts/return';
const REFRESH_URL = 'https://washedup.app/creator/payouts/refresh';
// every approved grant today is a founding partner; a non-founding rate is
// a reviewed change — and the per-organizer lock in the table governs.
const FOUNDING_PARTNER_BPS = 400;
const STRIPE_TIMEOUT_MS = 15_000;
const UNIQUE_VIOLATION = '23505';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS
    }
  });
}
async function stripePost(key, path, form) {
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), STRIPE_TIMEOUT_MS);
  try {
    const res = await fetch(`${STRIPE_API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(form).toString(),
      signal: ctrl.signal
    });
    const body = await res.json().catch(()=>({}));
    return {
      ok: res.ok,
      status: res.status,
      body
    };
  } catch  {
    return {
      ok: false,
      status: 0,
      body: {
        error: 'stripe unreachable'
      }
    };
  } finally{
    clearTimeout(t);
  }
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS
    });
  }
  if (req.method !== 'POST') return json(405, {
    error: 'method not allowed'
  });
  const stripeKey = Deno.env.get('STRIPE_CONNECT_ONBOARDING_KEY') ?? '';
  if (!stripeKey.startsWith('sk_')) {
    return json(500, {
      error: 'onboarding key missing'
    });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const service = createClient(supabaseUrl, serviceKey);
  // the caller: a real signed-in user, identity from the verified JWT only
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, {
    error: 'not signed in'
  });
  const userId = userData.user.id;
  // the gate: an APPROVED grant on either selling track
  const { data: grants, error: grantErr } = await service.from('operator_grants').select('track, status').eq('user_id', userId).eq('status', 'approved').in('track', [
    'event_host',
    'community_leader'
  ]);
  if (grantErr) return json(500, {
    error: 'grant check failed'
  });
  if (!grants || grants.length === 0) {
    return json(403, {
      error: 'no approved organizer grant'
    });
  }
  // one connected account per organizer: reuse the row if it exists
  const { data: existing, error: rowErr } = await service.from('organizer_stripe_accounts').select('stripe_account_id').eq('user_id', userId).maybeSingle();
  if (rowErr) return json(500, {
    error: 'account lookup failed'
  });
  let accountId = existing?.stripe_account_id;
  if (!accountId) {
    // the doc 61 §2 target config, exactly the shape the paywall lane
    // verified on the sandbox demo account: fees.payer=application,
    // losses.payments=application, requirement_collection=stripe,
    // express dashboard, MANUAL payouts from birth (lean 3 — no code path
    // can pay out before the release cron says so).
    const created = await stripePost(stripeKey, '/accounts', {
      country: 'US',
      'controller[fees][payer]': 'application',
      'controller[losses][payments]': 'application',
      'controller[requirement_collection]': 'stripe',
      'controller[stripe_dashboard][type]': 'express',
      'capabilities[card_payments][requested]': 'true',
      'capabilities[transfers][requested]': 'true',
      'settings[payouts][schedule][interval]': 'manual',
      'metadata[washedup_user_id]': userId
    });
    if (!created.ok || typeof created.body.id !== 'string') {
      return json(502, {
        error: 'stripe account creation failed',
        detail: created.body?.error?.message ?? null
      });
    }
    accountId = created.body.id;
    const { error: insertErr } = await service.from('organizer_stripe_accounts').insert({
      user_id: userId,
      stripe_account_id: accountId,
      commission_bps: FOUNDING_PARTNER_BPS
    });
    if (insertErr) {
      if (insertErr.code === UNIQUE_VIOLATION) {
        // the concurrent-create race: another request won the row while we
        // were at Stripe. Adopt the winner's account and carry on to the
        // link step; OUR just-created account becomes an inert orphan —
        // no row, nothing ever routes to it (accepted by the 7-21 verdict).
        const { data: winner, error: winErr } = await service.from('organizer_stripe_accounts').select('stripe_account_id').eq('user_id', userId).maybeSingle();
        if (winErr || !winner?.stripe_account_id) {
          return json(500, {
            error: 'race recovery failed — report this'
          });
        }
        accountId = winner.stripe_account_id;
      } else {
        // the account exists at Stripe but the lock row failed — surface
        // loudly; a retry reuses nothing (no row) and would double-create,
        // so this is the one path that needs a human eye.
        return json(500, {
          error: 'account created but not recorded — do not retry, report this',
          stripe_account_id: accountId
        });
      }
    }
  }
  const link = await stripePost(stripeKey, '/account_links', {
    account: accountId,
    refresh_url: REFRESH_URL,
    return_url: RETURN_URL,
    type: 'account_onboarding'
  });
  if (!link.ok || typeof link.body.url !== 'string') {
    return json(502, {
      error: 'onboarding link creation failed',
      detail: link.body?.error?.message ?? null
    });
  }
  return json(200, {
    url: link.body.url,
    stripe_account_id: accountId
  });
});
