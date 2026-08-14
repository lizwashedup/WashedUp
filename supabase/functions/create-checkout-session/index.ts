// create-checkout-session: the pay door to the contributor community.
// Docs 31/32; Liz's call-a resolution (2026-07-12): paying IS the door,
// no approval step. This function creates a Stripe Checkout Session for
// the signed-in caller; the stripe-webhook function seats them on payment.
//
// STRIPE TEST MODE ONLY until Liz says her account is verified.
// Secrets (edge function env, never in git):
//   STRIPE_SECRET_KEY      - sk_test_... until Liz flips
// Prices are resolved by Stripe lookup_key (contributor_monthly /
// contributor_yearly, created by the paywall-setup one-shot), so no price
// ids live in env and the founding-rate window later is a price swap, not
// a redeploy.
// Deploy with verify_jwt: true (callers are signed-in members-to-be).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@18';
import { corsHeaders } from '../_shared/cors.ts';
import { getHouseCommunity, getHouseMemberRow, hasContributorKey, jsonResponse, serviceClient, stripeKeyIsTest } from '../_shared/contributor.ts';
// success/cancel urls only ever point at our own web app
const ALLOWED_ORIGINS = [
  'https://washedup.app',
  'https://www.washedup.app',
  'http://localhost:3000'
];
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({
        error: 'Missing Authorization header'
      }, 401, corsHeaders);
    }
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '');
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !user) {
      return jsonResponse({
        error: userError?.message ?? 'Invalid or expired token'
      }, 401, corsHeaders);
    }
    const body = await req.json().catch(()=>({}));
    const interval = body?.interval === 'year' ? 'year' : 'month';
    const rateKind = body?.rate === 'founding' ? 'founding' : 'regular';
    const origin = ALLOWED_ORIGINS.includes(body?.origin) ? body.origin : ALLOWED_ORIGINS[0];
    // ARL consent (doc 30b §2): the client's unchecked-by-default checkbox
    // is server-enforced here — no consent record, no checkout session.
    // Evidence (who/when/version/price) is stamped into the session AND
    // subscription metadata below, parked at Stripe until the consent
    // ledger table rides its numbered schema proposal (doc 13).
    const consent = body?.consent;
    if (consent?.accepted !== true || typeof consent?.disclosure_version !== 'string' || consent.disclosure_version.length === 0 || consent.disclosure_version.length > 64) {
      // LIZ COPY
      return jsonResponse({
        error: 'please agree to the membership terms first.'
      }, 400, corsHeaders);
    }
    const consentVersion = consent.disclosure_version;
    const consentTerms = typeof consent?.terms_version === 'string' && consent.terms_version.length <= 64 ? consent.terms_version : null;
    const consentAt = new Date().toISOString();
    const admin = serviceClient();
    const house = await getHouseCommunity(admin);
    if (!house) {
      // LIZ COPY
      return jsonResponse({
        error: 'the community is not open yet.'
      }, 409, corsHeaders);
    }
    // never sell a checkout to someone already in, already keyed, or kicked
    const member = await getHouseMemberRow(admin, house.id, user.id);
    if (member?.status === 'active') {
      // LIZ COPY
      return jsonResponse({
        error: 'you are already in.'
      }, 400, corsHeaders);
    }
    if (member && [
      'banned',
      'removed',
      'declined'
    ].includes(member.status)) {
      // a kick must stick (proposal 32 call o); no checkout for kicked members
      // LIZ COPY
      return jsonResponse({
        error: 'this door is closed.'
      }, 403, corsHeaders);
    }
    if (await hasContributorKey(admin, user.id)) {
      // LIZ COPY
      return jsonResponse({
        error: 'you already have access.'
      }, 400, corsHeaders);
    }
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey || !stripeKeyIsTest(stripeKey)) {
      // test mode only until Liz's explicit live go (drop stripeKeyIsTest then)
      return jsonResponse({
        error: 'payments are not configured yet.'
      }, 503, corsHeaders);
    }
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2025-08-27.basil',
      httpClient: Stripe.createFetchHttpClient()
    });
    // the Founding Rate hold protocol (30b v1.3 §2, proposal 43): no hold,
    // no founding session — the atomic cap can never be oversold. any
    // refusal (cap full, window closed, already claimed once, or the
    // machinery not applied yet) makes the founding price UNOFFERABLE and
    // the client re-renders the regular offer.
    if (rateKind === 'founding') {
      let slot = 'unavailable';
      try {
        const { data, error } = await admin.rpc('acquire_founding_slot', {
          p_user_id: user.id
        });
        if (!error && typeof data === 'string') slot = data;
        else if (error) console.warn('founding slot rpc unavailable:', error.message);
      } catch (err) {
        console.warn('founding slot rpc failed:', err);
      }
      if (slot !== 'held') {
        // LIZ COPY
        return jsonResponse({
          error: 'the founding rate is no longer available.',
          founding_closed: true
        }, 409, corsHeaders);
      }
    }
    const lookupKey = rateKind === 'founding' ? interval === 'year' ? 'contributor_founding_yearly' : 'contributor_founding_monthly' : interval === 'year' ? 'contributor_yearly' : 'contributor_monthly';
    const prices = await stripe.prices.list({
      lookup_keys: [
        lookupKey
      ],
      active: true,
      limit: 1
    });
    const priceId = prices.data[0]?.id;
    if (!priceId) {
      return jsonResponse({
        error: 'payments are not configured yet.'
      }, 503, corsHeaders);
    }
    // one Stripe customer per user, forever (stripe_customers)
    let customerId;
    const { data: existingCustomer, error: custErr } = await admin.from('stripe_customers').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
    if (custErr) throw new Error(`customer lookup failed: ${custErr.message}`);
    if (existingCustomer) {
      customerId = existingCustomer.stripe_customer_id;
    } else {
      const created = await stripe.customers.create({
        email: user.email || undefined,
        metadata: {
          user_id: user.id
        }
      });
      customerId = created.id;
      const { error: upsertErr } = await admin.from('stripe_customers').upsert({
        user_id: user.id,
        stripe_customer_id: customerId
      }, {
        onConflict: 'user_id'
      });
      if (upsertErr) throw new Error(`customer save failed: ${upsertErr.message}`);
    }
    const consentMetadata = {
      user_id: user.id,
      consent_disclosure_version: consentVersion,
      consent_at: consentAt,
      consent_price: priceId,
      rate_kind: rateKind
    };
    if (consentTerms) consentMetadata.consent_terms_version = consentTerms;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      client_reference_id: user.id,
      metadata: consentMetadata,
      subscription_data: {
        metadata: consentMetadata
      },
      allow_promotion_codes: rateKind === 'regular',
      // founding sessions expire fast (Stripe minimum 30 min) so an
      // abandoned checkout frees its held slot quickly; the 35-min hold
      // outlives the session by design
      ...rateKind === 'founding' ? {
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60
      } : {},
      success_url: `${origin}/c/${house.handle}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/c/${house.handle}?checkout=cancelled`
    });
    return jsonResponse({
      url: session.url
    }, 200, corsHeaders);
  } catch (err) {
    console.error('create-checkout-session error:', err);
    return jsonResponse({
      error: 'something went sideways. try again in a moment.'
    }, 500, corsHeaders);
  }
});
