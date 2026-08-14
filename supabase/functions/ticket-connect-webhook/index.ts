import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
/**
 * ticket-connect-webhook — the Stripe Connect webhook RECEIVER (ticketing
 * lane, 2026-07-21, Cowork's sprint order; nits folded same day per
 * Cowork's approved-with-notes verdict).
 *
 * THE INBOX LAW (doc 61 §2, built as proposal 64): this handler does ONE
 * thing — verify the signature and INSERT the raw event into
 * ticket_webhook_events, idempotently (the unique constraint on
 * stripe_event_id IS the dedupe; ON CONFLICT DO NOTHING). Every state
 * transition happens in ticket-inbox-drain, never here. The 7-16 Vercel
 * webhook flakiness is the cautionary tale this shape exists for.
 *
 * Signature verification is hand-rolled WebCrypto HMAC-SHA256, 5-minute
 * timestamp tolerance, constant-time comparison. THE 7-21 NITS, folded: the
 * signed message uses the header's RAW timestamp token verbatim (never a
 * re-rendered number) prefixed to the RAW BODY BYTES from arrayBuffer
 * (never a re-encoded string), and the body is JSON-parsed exactly once.
 * verify_jwt is off: Stripe is the caller; the signature is the guard.
 *
 * FOUR SIGNING SECRETS (quad-secret, 2026-07-27, Cowork's order; extends
 * the 2026-07-26 Accounts-v2 two-secret split). Liz's platform is Accounts
 * v2 doing destination charges, so events split across two scopes that
 * Stripe requires be SEPARATE webhook destinations, each with its OWN
 * whsec — and now each scope exists in BOTH modes:
 *   TEST — STRIPE_WEBHOOK_SECRET_ACCOUNT  ("Your account" scope:
 *            checkout.session.completed / .expired, charge.refunded,
 *            charge.refund.updated)
 *        — STRIPE_WEBHOOK_SECRET_CONNECT  ("Connected accounts" scope:
 *            account.updated, payout.paid, payout.failed)
 *   LIVE — STRIPE_WEBHOOK_SECRET_ACCOUNT_LIVE (endpoint A,
 *            we_1TxwfIRjtvAMYRc7d3rQUuHQ, account scope, dahlia-pinned)
 *        — STRIPE_WEBHOOK_SECRET_CONNECT_LIVE (endpoint B,
 *            we_1TxwkLRjtvAMYRc7sWze3xlO, connected scope, dahlia-pinned)
 * Liz sets the two _LIVE secrets in Supabase herself; secret VALUES never
 * pass through the operator seat. An event is signed by exactly ONE of the
 * four; we verify against whichever configured secret matches — a forgery
 * matches none. The via= log line (env NAME only) makes the signing scope
 * AND mode auditable per event. Any subset configured degrades safely; 500
 * only when NONE is set. Until the quad-secret version deploys, live
 * deliveries failing signature is EXPECTED, not an incident.
 *
 * SNAPSHOT WEBHOOKS ONLY (Cowork, 2026-07-26): all destinations must be
 * classic snapshot webhooks (Developers → Webhooks) delivering the full
 * `data.object` payload. The v2 "event destinations" path delivers THIN
 * events ({type, related_object}, v2.core.account…) that the drain would
 * silently no-op through — that's a design change and is out of scope here.
 *
 * Mode note: receiving and recording live events moves no money — the inbox
 * records, the drain routes by event.type, and everything that touches
 * charges stays behind the drain's own gates (live checkout sessions never
 * carry our hold_id metadata; the checkout edge fn is test-key-only).
 */ const SIGNATURE_TOLERANCE_SECONDS = 300;
const MAX_BODY_BYTES = 1_000_000;
// the four per-destination signing secrets — two scopes × two modes; any
// one alone verifies its own destination's events, and each is now BOUND to
// the mode and the scope of that destination.
// LIVEMODE IS ENFORCED below. Before this, a signature match against ANY of
// the four secrets was accepted and event.livemode was never read, so a
// leaked TEST whsec (the low-value one: it sits in dev .env files and logs)
// could sign a forged body that says livemode true, and the drain would then
// act on it as a real account.updated (flipping payouts_enabled on an
// unverified organizer, who the release cron then pays) or a real payout.paid.
// SCOPE IS OBSERVED, not enforced: it is logged so the map below can be
// validated against real traffic first. Rejecting on a wrong guess here would
// drop a genuine checkout.session.completed and strand a customer who paid.
const WEBHOOK_SECRETS = [
  {
    name: 'STRIPE_WEBHOOK_SECRET_ACCOUNT',
    livemode: false,
    scope: 'account'
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET_CONNECT',
    livemode: false,
    scope: 'connect'
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET_ACCOUNT_LIVE',
    livemode: true,
    scope: 'account'
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET_CONNECT_LIVE',
    livemode: true,
    scope: 'connect'
  }
];
const SCOPE_EVENT_TYPES: Record<string, string[]> = {
  account: [
    'checkout.session.completed',
    'checkout.session.expired',
    'charge.refunded',
    'charge.refund.updated'
  ],
  connect: [
    'account.updated',
    'payout.paid',
    'payout.failed'
  ]
};
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for(let i = 0; i < a.length; i++)out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {
    name: 'HMAC',
    hash: 'SHA-256'
  }, false, [
    'sign'
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, message);
  return Array.from(new Uint8Array(sig)).map((b)=>b.toString(16).padStart(2, '0')).join('');
}
Deno.serve(async (req)=>{
  if (req.method !== 'POST') return json(405, {
    error: 'method not allowed'
  });
  // gather whichever of the four per-destination secrets are configured; a
  // valid whsec_ from any destination is accepted below. TRIM first: a pasted
  // secret with a trailing newline passes startsWith('whsec_') and then
  // fails HMAC forever, presenting as a signature bug — the single most
  // common webhook-setup failure.
  const configured = WEBHOOK_SECRETS.map((e)=>({
      ...e,
      secret: (Deno.env.get(e.name) ?? '').trim()
    })).filter((e)=>e.secret.startsWith('whsec_'));
  if (configured.length === 0) {
    return json(500, {
      error: 'webhook secret missing'
    });
  }
  // the raw body BYTES are what Stripe signed — read once, verify over the
  // bytes, decode for the single JSON parse below
  const bodyBytes = new Uint8Array(await req.arrayBuffer());
  if (bodyBytes.byteLength > MAX_BODY_BYTES) return json(413, {
    error: 'too large'
  });
  // Stripe-Signature: t=<ts>,v1=<hex>[,v1=<hex>...] — keep t's RAW token
  const sigHeader = req.headers.get('Stripe-Signature') ?? '';
  const parts = new Map();
  for (const piece of sigHeader.split(',')){
    const [k, v] = piece.split('=', 2);
    if (!k || !v) continue;
    const arr = parts.get(k.trim()) ?? [];
    arr.push(v.trim());
    parts.set(k.trim(), arr);
  }
  const rawTs = parts.get('t')?.[0] ?? '';
  const v1s = parts.get('v1') ?? [];
  const ts = Number(rawTs);
  if (!rawTs || !Number.isFinite(ts) || v1s.length === 0) {
    return json(400, {
      error: 'bad signature header'
    });
  }
  if (Math.abs(Date.now() / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) {
    return json(400, {
      error: 'timestamp outside tolerance'
    });
  }
  // signed message = <raw t token> '.' <raw body bytes>, byte-exact
  const prefix = new TextEncoder().encode(`${rawTs}.`);
  const message = new Uint8Array(prefix.byteLength + bodyBytes.byteLength);
  message.set(prefix, 0);
  message.set(bodyBytes, prefix.byteLength);
  // accept if any header v1 matches the HMAC under ANY configured secret;
  // the event's own destination determines which one signs it, a forgery none
  let verified = false;
  let matchedSecretName = null;
  let matched = null;
  for (const entry of configured){
    const { name, secret } = entry;
    const expected = await hmacSha256Hex(secret, message);
    if (v1s.some((v)=>timingSafeEqual(v, expected))) {
      verified = true;
      matched = entry;
      matchedSecretName = name; // the env NAME (never the value) — routing proof
      break;
    }
  }
  if (!verified || !matched) {
    // log the configured secret NAMES only (never values, never lengths) so a
    // one-secret misconfiguration is distinguishable from an actual forgery —
    // both return the same 401, so this line is the only diagnostic.
    console.error(`ticket-connect-webhook signature mismatch; configured secrets: ${configured.map((e)=>e.name).join(', ')}`);
    return json(401, {
      error: 'signature mismatch'
    });
  }
  // parse ONCE; the same object is validated and stored
  let event;
  try {
    event = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch  {
    return json(400, {
      error: 'not json'
    });
  }
  const eventId = event.id;
  const eventType = event.type;
  if (typeof eventId !== 'string' || !eventId.startsWith('evt_') || typeof eventType !== 'string') {
    return json(400, {
      error: 'not a stripe event'
    });
  }
  // MODE BINDING. Fail CLOSED on a missing livemode: every Stripe snapshot
  // event carries it (all 93 rows in ticket_webhook_events do, checked
  // 2026-08-14), so its absence means malformed or forged, never legitimate.
  if (typeof event.livemode !== 'boolean') {
    console.error(`ticket-connect-webhook rejected evt=${eventId} type=${eventType}: no boolean livemode`);
    return json(400, {
      error: 'event livemode missing'
    });
  }
  // the actual fix: an event is only accepted under a secret of its OWN mode,
  // in both directions (a live secret cannot sign a test event either).
  if (event.livemode !== matched.livemode) {
    console.error(`ticket-connect-webhook MODE MISMATCH evt=${eventId} type=${eventType} livemode=${event.livemode} signed-by=${matched.name}`);
    return json(401, {
      error: 'event mode does not match its signing secret'
    });
  }
  // observed only. A hit means the map above is wrong or a destination is
  // subscribed past its documented set. Turn this into a 401 once a week of
  // real traffic logs no hits.
  if (!(SCOPE_EVENT_TYPES[matched.scope] ?? []).includes(eventType)) {
    console.error(`ticket-connect-webhook SCOPE UNEXPECTED evt=${eventId} type=${eventType} signed-by=${matched.name} scope=${matched.scope} (observed, not rejected)`);
  }
  // routing proof (verification only): record which per-destination secret
  // verified this event, by env NAME — never the value. Read back via
  // get_logs to prove each destination's events verify under exactly one
  // secret (and which MODE signed it).
  console.log(`ticket-connect-webhook verified evt=${eventId} type=${eventType} via=${matchedSecretName} livemode=${event.livemode} scope=${matched.scope}`);
  const service = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  // the inbox insert — dedupe is the unique constraint, not app logic.
  // upsert+ignoreDuplicates = INSERT ... ON CONFLICT DO NOTHING.
  const { error } = await service.from('ticket_webhook_events').upsert({
    stripe_event_id: eventId,
    type: eventType,
    payload: event
  }, {
    onConflict: 'stripe_event_id',
    ignoreDuplicates: true
  });
  if (error) {
    // 500 → Stripe retries → the dedupe absorbs the replay. Never lose an
    // event to a transient DB error.
    return json(500, {
      error: 'inbox write failed'
    });
  }
  return json(200, {
    received: true
  });
});
