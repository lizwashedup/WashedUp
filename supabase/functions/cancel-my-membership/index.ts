// cancel-my-membership: the fully-online, no-ceremony cancel (doc 30b §4).
// The signed-in member cancels (or un-cancels) THEIR OWN contributor
// membership: cancel sets cancel_at_period_end so access runs to the end
// of the paid period (doc 24 model, never instant), resume flips it back
// before the period ends. Nothing beyond signing in is required — no
// email thread, no phone call, no survey wall.
//
// Distinct from cancel-contributor-subscription (the leader's removal
// lever, immediate cancel). This one is the member's own hand.
//
// Deploy with verify_jwt: true. Secrets: STRIPE_SECRET_KEY (test mode
// enforced until Liz's live go).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@18';
import { corsHeaders } from '../_shared/cors.ts';
import { CURRENT_SUB_STATUSES, jsonResponse, serviceClient, stripeKeyIsTest } from '../_shared/contributor.ts';
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
    const action = body?.action === 'resume' ? 'resume' : 'cancel';
    const admin = serviceClient();
    // the caller's own current subscription — never anyone else's
    const { data: subRow, error: subErr } = await admin.from('contributor_subscriptions').select('stripe_subscription_id, status, current_period_end').eq('user_id', user.id).in('status', CURRENT_SUB_STATUSES).order('created_at', {
      ascending: false
    }).limit(1).maybeSingle();
    if (subErr) throw new Error(`subscription lookup failed: ${subErr.message}`);
    if (!subRow) {
      // LIZ COPY (founding-grant members land here too: nothing to cancel,
      // there is no card on file and no billing — doc 30b §7)
      return jsonResponse({
        error: 'no active paid membership to change.'
      }, 404, corsHeaders);
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
    const updated = await stripe.subscriptions.update(subRow.stripe_subscription_id, {
      cancel_at_period_end: action === 'cancel'
    });
    // mirror immediately so the UI reads true without waiting on the
    // webhook's subscription.updated (which also lands and agrees)
    const { error: mirrorErr } = await admin.from('contributor_subscriptions').update({
      cancel_at_period_end: updated.cancel_at_period_end ?? false
    }).eq('stripe_subscription_id', subRow.stripe_subscription_id);
    if (mirrorErr) console.warn(`mirror update failed: ${mirrorErr.message}`);
    return jsonResponse({
      action,
      cancel_at_period_end: updated.cancel_at_period_end ?? false,
      current_period_end: subRow.current_period_end
    }, 200, corsHeaders);
  } catch (err) {
    console.error('cancel-my-membership error:', err);
    return jsonResponse({
      error: 'something went sideways. try again in a moment.'
    }, 500, corsHeaders);
  }
});
