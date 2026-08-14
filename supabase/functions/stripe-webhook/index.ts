// stripe-webhook: the key-turner for the contributor community.
// Docs 31/32; Liz's call-a resolution (2026-07-12): the webhook seats a
// paid member automatically (no approval step), passing proposal 32's gate
// because the subscription row exists before the member write.
//
// LIZ'S STANDING RULES CARRIED HERE (2026-07-12):
//   - the webhook NEVER re-seats a removed or banned row. money never buys
//     a way past a kick. if a kicked member's subscription is somehow still
//     live, we cancel it at Stripe (stop charging someone thrown out).
//   - refund-on-ban = NO by default (Liz's call, revisitable).
//   - cancellation lapses at period end, never instantly: Stripe keeps the
//     sub 'active' until the period ends, then sends subscription.deleted,
//     and only then do we flip the member row to 'left' (mute-not-delete).
//
// Idempotency: every event id lands in stripe_webhook_events first. a row
// with processed_at set = done, duplicates are acknowledged and skipped;
// a row without processed_at = an earlier attempt failed, so Stripe's
// retry reprocesses it (every handler below is idempotent).
//
// STRIPE TEST MODE ONLY until Liz says her account is verified.
// Secrets (edge function env, never in git):
//   STRIPE_SECRET_KEY       - sk_test_... until Liz flips
//   STRIPE_WEBHOOK_SECRET   - whsec_... from the Stripe webhook endpoint
// Deploy with verify_jwt: FALSE (Stripe cannot send a Supabase JWT; the
// Stripe-Signature check below is the authentication).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@18';
import { CURRENT_SUB_STATUSES, getHouseCommunity, getHouseMemberRow, serviceClient, stripeKeyIsTest } from '../_shared/contributor.ts';
const cryptoProvider = Stripe.createSubtleCryptoProvider();
function stripeClient(key) {
  return new Stripe(key ?? '', {
    apiVersion: '2025-08-27.basil',
    httpClient: Stripe.createFetchHttpClient()
  });
}
// mirror a Stripe subscription object into contributor_subscriptions
// (one row per stripe_subscription_id, updated in place; proposal 32 call k)
async function upsertSubscription(admin, sub, userId) {
  const periodEnd = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end ?? null;
  const { error } = await admin.from('contributor_subscriptions').upsert({
    user_id: userId,
    stripe_subscription_id: sub.id,
    stripe_price_id: sub.items?.data?.[0]?.price?.id ?? null,
    status: sub.status,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null
  }, {
    onConflict: 'stripe_subscription_id'
  });
  if (error) throw new Error(`subscription upsert failed: ${error.message}`);
}
// the ARL confirmation email (doc 30b §3), sent immediately on purchase:
// what was bought, amount + frequency, a plain renewal statement, the
// cancel policy, a DIRECT cancel link, and a person to reach. best-effort
// (a mail hiccup must never fail the seat); Resend, like the house's
// other mail. all wording LIZ COPY.
async function sendConfirmationEmail(toEmail, amountCents, intervalWord, houseHandle) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    console.warn('confirmation email skipped: RESEND_API_KEY not set');
    return;
  }
  const from = Deno.env.get('RESEND_FROM_EMAIL') ?? 'washedup <hello@washedup.app>';
  const amount = `$${(amountCents / 100).toFixed(2)}`;
  const cancelUrl = `https://washedup.app/c/${houseHandle}?manage=membership`;
  const body = [
    `you're a washedup contributor now. here's the paper trail, for keeps:`,
    ``,
    `what: washedup contributor membership`,
    `amount: ${amount} every ${intervalWord}`,
    `renewal: your membership renews automatically at ${amount} every ${intervalWord} until you cancel.`,
    `canceling: cancel anytime online, no hoops. it takes effect at the end of your current paid period, and there are no refunds for partial periods.`,
    `cancel here: ${cancelUrl}`,
    ``,
    `questions, thoughts, anything: liz@washedup.app. a person reads it.`
  ].join('\n');
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [
          toEmail
        ],
        subject: "you're in — your washedup contributor membership",
        text: body
      })
    });
    if (!res.ok) {
      console.error('confirmation email failed:', res.status, (await res.text()).slice(0, 200));
    }
  } catch (err) {
    console.error('confirmation email error:', err);
  }
}
// consent evidence into the ledger (proposals 39 + 42): the values were
// stamped into the session metadata by create-checkout-session at consent
// time. best-effort until the riders land — the same evidence stays
// queryable in Stripe metadata regardless, so nothing is ever lost. tries
// the full v1.3 shape first; before proposal 43's columns exist it falls
// back to the 39 shape.
async function tryRecordConsent(admin, session, subscriptionId, sub) {
  const m = session.metadata ?? {};
  if (!m.user_id || !m.consent_disclosure_version) return;
  const base = {
    user_id: m.user_id,
    disclosure_version: m.consent_disclosure_version,
    price_id: m.consent_price ?? null,
    consented_at: m.consent_at ?? null,
    stripe_checkout_session_id: session.id,
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null
  };
  const item = sub.items?.data?.[0];
  const full = {
    ...base,
    amount_cents: item?.price?.unit_amount ?? null,
    currency: item?.price?.currency ?? null,
    billing_frequency: item?.price?.recurring?.interval ?? null,
    rate_kind: m.rate_kind === 'founding' ? 'founding' : 'regular',
    terms_version: m.consent_terms_version ?? null
  };
  const { error } = await admin.from('consent_evidence').insert(full);
  if (error) {
    // 43's columns not applied yet: fall back to the 39 shape
    const { error: fallbackErr } = await admin.from('consent_evidence').insert(base);
    if (fallbackErr) console.warn(`consent ledger skipped (riders pending): ${fallbackErr.message}`);
  }
}
// the Founding Rate over-cap fallback (30b v1.3 §2, proposal 43): the
// 101st completed purchase may NOT keep the founding price. structurally
// near-impossible under the hold protocol; if it ever fires it is loud:
// cancel the subscription, refund the payment, tell the person plainly,
// and leave the regular door open. every step best-effort with CRITICAL
// logging for manual follow-up if any piece fails.
async function handleFoundingOverCap(admin, stripe, userId, subscriptionId) {
  console.error(`CRITICAL founding over_cap: user ${userId} sub ${subscriptionId} — canceling + refunding`);
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: [
        'latest_invoice.payment_intent'
      ]
    });
    await stripe.subscriptions.cancel(subscriptionId);
    const invoice = sub.latest_invoice;
    const pi = invoice?.payment_intent;
    const piId = typeof pi === 'string' ? pi : pi?.id ?? null;
    if (piId) {
      await stripe.refunds.create({
        payment_intent: piId
      });
    } else {
      console.error(`CRITICAL founding over_cap: no payment intent found for ${subscriptionId}, refund manually`);
    }
  } catch (err) {
    console.error('CRITICAL founding over_cap cleanup failed, manual action required:', err);
  }
  // LIZ COPY: the explicit, warm error (v1.3 §2: explicit error + new checkout)
  await tryNotify(admin, userId, 'contributor_payment_failed', 'about the founding rate', 'the founding spots filled right as you were checking out. your payment was refunded in full and nothing was kept. the regular door is open whenever you want it.');
}
// best-effort notification: the contributor_* notification types are a
// pending schema rider (proposal 32 call l), so failure here is non-fatal
async function tryNotify(admin, userId, type, title, body) {
  const { error } = await admin.from('app_notifications').insert({
    user_id: userId,
    type,
    title,
    body
  });
  if (error) console.warn(`notification skipped (${type}): ${error.message}`);
}
// seat a paid member. returns a short outcome string for the event ledger.
async function seatMember(admin, stripe, userId, subscriptionId) {
  const house = await getHouseCommunity(admin);
  if (!house) return 'no_house_community';
  const member = await getHouseMemberRow(admin, house.id, userId);
  if (member && [
    'banned',
    'removed'
  ].includes(member.status)) {
    // a kick must stick: never re-seat, and stop charging them going forward
    if (subscriptionId) {
      try {
        await stripe.subscriptions.cancel(subscriptionId);
      } catch (err) {
        console.error(`cancel-after-kick failed for ${subscriptionId}:`, err);
      }
    }
    return `not_seated_${member.status}`;
  }
  if (member?.status === 'active') return 'already_active';
  if (!member) {
    const { error } = await admin.from('community_members').insert({
      community_id: house.id,
      user_id: userId,
      role: 'member',
      status: 'active',
      joined_at: new Date().toISOString()
    });
    if (error) throw new Error(`member insert failed: ${error.message}`);
  } else {
    // pending or left: walk them (back) in
    const { error } = await admin.from('community_members').update({
      status: 'active',
      joined_at: member.joined_at ?? new Date().toISOString()
    }).eq('id', member.id);
    if (error) throw new Error(`member activate failed: ${error.message}`);
  }
  // LIZ COPY: the welcome moment ('community_join_approved' already exists
  // in the notification CHECK, so this one is not best-effort-only by need,
  // but stays non-fatal all the same)
  await tryNotify(admin, userId, 'community_join_approved', "you're in", `${house.name} is yours now. come say hi.`);
  return member ? 'reactivated' : 'seated';
}
// lapse at period end: active -> left, unless a founding grant or another
// current subscription still holds the door open
async function lapseMember(admin, userId) {
  const house = await getHouseCommunity(admin);
  if (!house) return 'no_house_community';
  const member = await getHouseMemberRow(admin, house.id, userId);
  if (!member || member.status !== 'active' || member.role !== 'member') {
    return 'not_lapsable';
  }
  const [grant, sub] = await Promise.all([
    admin.from('contributor_founding_grants').select('user_id').eq('user_id', userId).is('revoked_at', null).limit(1).maybeSingle(),
    admin.from('contributor_subscriptions').select('id').eq('user_id', userId).in('status', CURRENT_SUB_STATUSES).limit(1).maybeSingle()
  ]);
  if (grant.data || sub.data) return 'still_keyed';
  const { error } = await admin.from('community_members').update({
    status: 'left'
  }).eq('id', member.id);
  if (error) throw new Error(`member lapse failed: ${error.message}`);
  // LIZ COPY: the warm goodbye, door stays open ('contributor_lapsed' is a
  // pending notification-type rider, so this is best-effort until it lands)
  await tryNotify(admin, userId, 'contributor_lapsed', 'until next time', "your contributor membership wrapped up. the door's open whenever you want back in.");
  return 'lapsed';
}
function subUserId(sub) {
  return sub.metadata?.user_id ?? null;
}
Deno.serve(async (req)=>{
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!signature || !webhookSecret) {
    return new Response('missing signature', {
      status: 400
    });
  }
  const rawBody = await req.text();
  // read + trim once, feed the same string to the client AND the gate below
  // so they can never disagree about what key is actually in play.
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
  const stripe = stripeClient(stripeKey);
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret, undefined, cryptoProvider);
  } catch (err) {
    console.error('webhook signature verification failed:', err);
    return new Response('invalid signature', {
      status: 400
    });
  }
  // test mode only until Liz's explicit live go. Two independent checks,
  // not one: the API key (same stripeKeyIsTest gate every sibling function
  // already has) AND the event itself (event.livemode, fail-closed on the
  // field ever being missing) — a live webhook endpoint delivering a real
  // event would pass a key-only check even with a test STRIPE_SECRET_KEY
  // configured, since several handlers below never call the Stripe API at
  // all and act purely on the event payload. Stripe retries a non-2xx
  // within its live retry window, so this holds the event rather than
  // dropping it: fix the key/endpoint situation and the backlog replays on
  // its own (past that window Stripe drops it, it does not wait forever).
  if (!stripeKey || !stripeKeyIsTest(stripeKey) || event.livemode !== false) {
    console.warn(`stripe-webhook refusing event ${event.id} (${event.type}): key_test=${Boolean(stripeKey && stripeKeyIsTest(stripeKey))} event_livemode=${event.livemode}`);
    return new Response('payments are not configured yet', {
      status: 503
    });
  }
  const admin = serviceClient();
  // idempotency ledger: insert-first; processed rows skip, unprocessed
  // rows (an earlier failed attempt) fall through and reprocess
  const { data: existing, error: lookupErr } = await admin.from('stripe_webhook_events').select('id, processed_at').eq('id', event.id).maybeSingle();
  if (lookupErr) {
    console.error('event ledger lookup failed:', lookupErr.message);
    return new Response('ledger error', {
      status: 500
    });
  }
  if (existing?.processed_at) {
    return new Response(JSON.stringify({
      received: true,
      duplicate: true
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  if (!existing) {
    const { error: insertErr } = await admin.from('stripe_webhook_events').insert({
      id: event.id,
      type: event.type,
      payload: event
    });
    // a concurrent delivery may have raced us in; treat conflict as duplicate
    if (insertErr) {
      if (insertErr.code === '23505') {
        return new Response(JSON.stringify({
          received: true,
          duplicate: true
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
      console.error('event ledger insert failed:', insertErr.message);
      return new Response('ledger error', {
        status: 500
      });
    }
  }
  let outcome = 'ignored';
  try {
    switch(event.type){
      case 'checkout.session.completed':
        {
          const session = event.data.object;
          const userId = session.client_reference_id ?? session.metadata?.user_id ?? null;
          const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null;
          if (!userId || !subscriptionId) {
            outcome = 'missing_user_or_subscription';
            break;
          }
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          // the Founding Rate claim (proposal 43): confirm BEFORE seating.
          // over_cap = the v1.3 fallback (cancel + refund + explicit note),
          // and the person is NOT seated on this purchase.
          if (session.metadata?.rate_kind === 'founding') {
            let claim = 'unavailable';
            try {
              const { data, error } = await admin.rpc('confirm_founding_slot', {
                p_user_id: userId,
                p_subscription_id: subscriptionId
              });
              if (!error && typeof data === 'string') claim = data;
              else if (error) console.warn('founding confirm rpc unavailable:', error.message);
            } catch (err) {
              console.warn('founding confirm rpc failed:', err);
            }
            if (claim === 'over_cap') {
              await upsertSubscription(admin, sub, userId);
              await handleFoundingOverCap(admin, stripe, userId, subscriptionId);
              outcome = 'founding_over_cap';
              break;
            }
          }
          await upsertSubscription(admin, sub, userId);
          outcome = await seatMember(admin, stripe, userId, subscriptionId);
          // consent evidence (proposals 39+42; best-effort until they land)
          await tryRecordConsent(admin, session, subscriptionId, sub);
          // the ARL confirmation email (doc 30b §3), on the purchase moment;
          // address sourced stripe-customer-first per the 7-13 decision
          if ([
            'seated',
            'reactivated',
            'already_active'
          ].includes(outcome)) {
            const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
            const toEmail = await resolveEmail(admin, stripe, userId, customerId, session.customer_details?.email ?? null);
            const item = sub.items?.data?.[0];
            const amountCents = item?.price?.unit_amount ?? null;
            const intervalWord = item?.price?.recurring?.interval ?? null;
            const house = await getHouseCommunity(admin);
            if (toEmail && amountCents && intervalWord && house) {
              await sendConfirmationEmail(toEmail, amountCents, intervalWord, house.handle);
            } else {
              console.warn('confirmation email skipped: missing email/price/house');
            }
          }
          break;
        }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        {
          const sub = event.data.object;
          const userId = subUserId(sub);
          if (!userId) {
            outcome = 'missing_user_metadata';
            break;
          }
          await upsertSubscription(admin, sub, userId);
          if ([
            'active',
            'trialing'
          ].includes(sub.status)) {
            // covers renewals and billing-portal reactivations; seatMember
            // no-ops for already-active and never re-seats removed/banned
            outcome = await seatMember(admin, stripe, userId, sub.id);
          } else {
            outcome = `recorded_${sub.status}`;
          }
          break;
        }
      case 'customer.subscription.deleted':
        {
          const sub = event.data.object;
          const userId = subUserId(sub);
          if (!userId) {
            outcome = 'missing_user_metadata';
            break;
          }
          await upsertSubscription(admin, sub, userId);
          // the v1.3 §3 cancellation timestamp on the consent ledger
          // (best-effort until proposal 43's column exists)
          const { error: cancelStampErr } = await admin.from('consent_evidence').update({
            canceled_at: new Date().toISOString()
          }).eq('stripe_subscription_id', sub.id);
          if (cancelStampErr) console.warn(`canceled_at stamp skipped: ${cancelStampErr.message}`);
          outcome = await lapseMember(admin, userId);
          break;
        }
      case 'checkout.session.expired':
        {
          // a founding checkout abandoned: release the held slot eagerly
          // (it would self-expire anyway; this just frees it sooner)
          const session = event.data.object;
          const userId = session.client_reference_id ?? session.metadata?.user_id ?? null;
          if (userId && session.metadata?.rate_kind === 'founding') {
            try {
              const { data } = await admin.rpc('release_founding_slot', {
                p_user_id: userId
              });
              outcome = `released_${data ?? 'unknown'}`;
            } catch  {
              outcome = 'release_unavailable';
            }
          } else {
            outcome = 'ignored';
          }
          break;
        }
      case 'invoice.payment_failed':
        {
          const invoice = event.data.object;
          const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
          if (!customerId) {
            outcome = 'missing_customer';
            break;
          }
          const { data: mapped } = await admin.from('stripe_customers').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
          if (mapped) {
            // LIZ COPY: the gentle renewal nudge (pending notification-type
            // rider; best-effort until it lands). the subscription status
            // itself arrives via customer.subscription.updated.
            await tryNotify(admin, mapped.user_id, 'contributor_payment_failed', 'a small hiccup', 'your contributor renewal did not go through. update your card whenever you get a sec, no rush.');
            outcome = 'payment_failed_noted';
          } else {
            outcome = 'unknown_customer';
          }
          break;
        }
      default:
        outcome = 'ignored';
    }
    const { error: doneErr } = await admin.from('stripe_webhook_events').update({
      processed_at: new Date().toISOString()
    }).eq('id', event.id);
    if (doneErr) console.error('event ledger completion failed:', doneErr.message);
    return new Response(JSON.stringify({
      received: true,
      outcome
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    // leave processed_at null so Stripe's retry reprocesses this event
    console.error(`webhook handler failed for ${event.type} (${event.id}):`, err);
    return new Response('handler error', {
      status: 500
    });
  }
});
// the recipient address, per Cowork's 7-13 sourcing decision: the STRIPE
// CUSTOMER RECORD first (checkout collects it from every payer; receipts
// already go there), the auth-record email as fallback. grant members
// never hit checkout and fall back to in-app notification elsewhere.
async function resolveEmail(admin, stripe, userId, stripeCustomerId, sessionEmail) {
  if (sessionEmail) return sessionEmail;
  if (stripeCustomerId) {
    try {
      const cust = await stripe.customers.retrieve(stripeCustomerId);
      if (!cust.deleted && cust.email) return cust.email;
    } catch (err) {
      console.warn('stripe customer email lookup failed:', err);
    }
  }
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  } catch  {
    return null;
  }
}
