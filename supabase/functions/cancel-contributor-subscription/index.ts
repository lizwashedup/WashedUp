// cancel-contributor-subscription: the removal lever's money half.
// Liz's rule (2026-07-12): removing or banning a house member also CANCELS
// their Stripe subscription going forward. Stop charging someone thrown
// out. Refund-on-ban = NO by default (Liz's call, revisitable), so the
// cancel is immediate with no refund; the remaining paid time is forfeit
// with the seat.
//
// Called by the creator console (web/native) right after Liz removes or
// bans a member of the contributor community. Idempotent: canceling an
// already-canceled subscription is a no-op.
//
// Authorization: the caller must be a leader/co_leader/admin/member_care of
// the house community, or the admin. Nothing here touches any other community.
// Deploy with verify_jwt: true.
//
// Secrets: STRIPE_SECRET_KEY (sk_test_... until Liz flips).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@18';
import { corsHeaders } from '../_shared/cors.ts';
import { CURRENT_SUB_STATUSES, getHouseCommunity, jsonResponse, serviceClient, stripeKeyIsTest } from '../_shared/contributor.ts';
const ADMIN_EMAIL = 'liz@washedup.app'; // mirrors public.is_admin
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
    const targetUserId = body?.user_id;
    if (!targetUserId) {
      return jsonResponse({
        error: 'user_id is required'
      }, 400, corsHeaders);
    }
    const admin = serviceClient();
    const house = await getHouseCommunity(admin);
    if (!house) {
      return jsonResponse({
        error: 'the community is not open yet.'
      }, 409, corsHeaders);
    }
    // caller must run the house (leader/co_leader) or be the admin
    let authorized = user.email === ADMIN_EMAIL;
    if (!authorized) {
      const { data: leaderRow, error: leaderErr } = await admin.from('community_members').select('id').eq('community_id', house.id).eq('user_id', user.id).eq('status', 'active').in('role', [
        'leader',
        'co_leader',
        'admin',
        'member_care'
      ]).limit(1).maybeSingle();
      if (leaderErr) throw new Error(`leader check failed: ${leaderErr.message}`);
      authorized = Boolean(leaderRow);
    }
    if (!authorized) {
      return jsonResponse({
        error: 'Not authorized'
      }, 403, corsHeaders);
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
    // cancel every current subscription the kicked member holds; the
    // webhook's subscription.deleted then records the final status
    const { data: subs, error: subsErr } = await admin.from('contributor_subscriptions').select('stripe_subscription_id, status').eq('user_id', targetUserId).in('status', [
      ...CURRENT_SUB_STATUSES,
      'incomplete'
    ]);
    if (subsErr) throw new Error(`subscription lookup failed: ${subsErr.message}`);
    let cancelled = 0;
    for (const row of subs ?? []){
      try {
        await stripe.subscriptions.cancel(row.stripe_subscription_id);
        cancelled += 1;
      } catch (err) {
        const alreadyCanceled = err instanceof Stripe.errors.StripeError && err.code === 'resource_missing';
        if (!alreadyCanceled) {
          console.error(`cancel failed for ${row.stripe_subscription_id}:`, err);
          throw err;
        }
      }
    }
    return jsonResponse({
      cancelled
    }, 200, corsHeaders);
  } catch (err) {
    console.error('cancel-contributor-subscription error:', err);
    return jsonResponse({
      error: 'something went sideways. try again in a moment.'
    }, 500, corsHeaders);
  }
});
