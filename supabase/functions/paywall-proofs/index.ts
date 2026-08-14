// paywall-proofs: token-guarded proof harness for the contributor paywall,
// PRE-APPLY EDITION (docs 31/32). Runs the proofs that are possible before
// proposal 32's tables exist and before the house community is born:
//
//   P1. webhook rejects a garbage signature (400 'invalid signature')
//   P2. webhook rejects a stale-timestamped but correctly signed event
//       (Stripe tolerance is 300s; proves timestamp checking is on)
//   P3. webhook ACCEPTS a freshly signed event: it must get PAST the
//       signature gate and fail only at the schema layer ('ledger error'
//       500, because stripe_webhook_events does not exist yet). That
//       failure point IS the proof that verification passed.
//   P4. env sanity: STRIPE_WEBHOOK_SECRET present and whsec-shaped,
//       STRIPE_SECRET_KEY present and test-mode (reports shape only,
//       never values).
//
// Signing happens HERE, with the secret read from env; the secret never
// leaves the function. Synthetic events use an id outside Stripe's evt_
// space (evt_selftest_...) so nothing can collide with real deliveries.
// Tombstoned after the proofs run, like paywall-setup.
//
// Invoked manually with an x-setup-token header (PAYWALL_PROOFS_RUN_TOKEN;
// must be set in Supabase function secrets, matching the ticket-inbox-drain
// / ticket-payout-release run-token pattern). Previously a hardcoded
// plaintext value in source; fixed 2026-08-13, secret still needs rotating.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const WEBHOOK_URL = 'https://upstjumasqblszevlgik.supabase.co/functions/v1/stripe-webhook';
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for(let i = 0; i < a.length; i++)out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
async function signPayload(secret, payload, timestamp) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {
    name: 'HMAC',
    hash: 'SHA-256'
  }, false, [
    'sign'
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`));
  const hex = Array.from(new Uint8Array(sig)).map((b)=>b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}
async function postToWebhook(payload, signature) {
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signature
    },
    body: payload
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text.slice(0, 120)
  };
}
Deno.serve(async (req)=>{
  const proofToken = Deno.env.get('PAYWALL_PROOFS_RUN_TOKEN') ?? '';
  const givenToken = req.headers.get('x-setup-token') ?? '';
  if (!proofToken || !timingSafeEqual(givenToken, proofToken)) {
    return new Response('not found', {
      status: 404
    });
  }
  try {
    const whsec = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
    const skey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
    const env_sanity = {
      webhook_secret_present: whsec.length > 0,
      webhook_secret_shape_ok: whsec.startsWith('whsec_'),
      // diagnostics that reveal nothing: where (if anywhere) 'whsec_' sits
      // in the stored value, and its length bucket. a real whsec is ~38
      // chars starting with the marker; leading junk or a wrong paste show
      // up here without exposing a single secret character.
      webhook_secret_contains_marker: whsec.includes('whsec_'),
      webhook_secret_marker_at: whsec.indexOf('whsec_'),
      webhook_secret_length: whsec.length,
      stripe_key_present: skey.length > 0,
      stripe_key_test_mode: skey.startsWith('sk_test_') || skey.startsWith('rk_test_')
    };
    const payload = JSON.stringify({
      id: `evt_selftest_${crypto.randomUUID().replaceAll('-', '')}`,
      object: 'event',
      type: 'paywall.selftest',
      data: {
        object: {}
      }
    });
    const now = Math.floor(Date.now() / 1000);
    // P1: garbage signature
    const p1 = await postToWebhook(payload, 't=0,v1=deadbeef');
    // P2: correctly signed but 20 minutes stale (tolerance is 300s)
    const staleTs = now - 1200;
    const p2 = await postToWebhook(payload, await signPayload(whsec, payload, staleTs));
    // P3: freshly and correctly signed
    const p3 = await postToWebhook(payload, await signPayload(whsec, payload, now));
    return Response.json({
      env_sanity,
      p1_garbage_signature: {
        ...p1,
        pass: p1.status === 400
      },
      p2_stale_signature: {
        ...p2,
        pass: p2.status === 400
      },
      p3_valid_signature: {
        ...p3,
        // pre-apply expectation: past the signature gate, stopped only by
        // the missing ledger table = 500 'ledger error'. After proposal 32
        // applies, this same probe returns 200 with outcome 'ignored'.
        pass_pre_apply: p3.status === 500 && p3.body.includes('ledger'),
        pass_post_apply: p3.status === 200
      }
    });
  } catch (err) {
    console.error('paywall-proofs error:', err);
    const detail = err instanceof Error ? err.message.slice(0, 200) : 'unknown';
    return Response.json({
      error: 'proofs failed',
      detail
    }, {
      status: 500
    });
  }
});
