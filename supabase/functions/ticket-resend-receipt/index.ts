import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchWithTimeout } from '../_shared/fetchWithTimeout.ts';

/**
 * ticket-resend-receipt — TK-05 (2026-08-19), the real half of "email/wallet
 * action" on the confirmation screen. A real Apple/Google Wallet pass needs
 * external enrollment (Apple Developer pass-type-id + certs, and/or a Google
 * Wallet issuer account) that nobody has done yet — not buildable by any
 * code change tonight, so this is scoped to email only.
 *
 * This is NOT a reuse of ticket-inbox-drain's sendBuyerConfirmation: that
 * send is a ONE-TIME claim keyed on ticket_orders.confirmation_email_sent_at
 * IS NULL (doc 112's idempotency law) and can never resend by design, and
 * the buyer's checkout email is deliberately never persisted onto
 * ticket_orders (doc 112) — there is nothing stored to resend TO. Instead
 * this reads the CALLER's own verified auth email (from the JWT this
 * function verifies) and sends the same branded template to that address.
 * Since the caller must be signed in as the order's own buyer, this is
 * always the account the buyer is actually looking at their tickets from.
 *
 * CONTRACT: POST, verify_jwt on. Body: { order_id: string }.
 * Success: { ok: true }. Failure: 4xx/5xx with { error }.
 *
 * A durable per-order cooldown is claimed server-side before the provider
 * call. Client button state is convenience only, never the abuse boundary.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// same sender + wallet url as ticket-inbox-drain's confirmation email, so a
// resend reads as the same message, not a different one
const CONFIRMATION_FROM = 'washedup <tickets@washedup.app>';
const WALLET_URL = 'https://washedup.app/app/tickets';
const RESEND_COOLDOWN_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 5_000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
  if (!resendKey) return json(503, { error: 'email is not configured yet.' });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'unauthenticated' });

  let body: { order_id?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid body' });
  }
  const orderId = body.order_id ?? '';
  if (!orderId) return json(400, { error: 'order_id is required' });

  // caller identity + email from the verified JWT (never a stored checkout
  // email — doc 112 never persists that onto ticket_orders)
  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  const callerId = userData?.user?.id;
  const callerEmail = userData?.user?.email;
  if (userErr || !callerId) return json(401, { error: 'unauthenticated' });
  if (!callerEmail) return json(409, { error: 'this account has no email to send to.' });

  const service = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const { data: order, error: ordErr } = await service
    .from('ticket_orders')
    .select('id, qty, total_cents, status, buyer_user_id, event_id')
    .eq('id', orderId)
    .maybeSingle();
  if (ordErr || !order) return json(404, { error: 'order not found' });
  if (order.buyer_user_id !== callerId) return json(403, { error: 'not your order' });
  if (order.status !== 'paid') return json(409, { error: `order is ${order.status}, nothing to resend` });

  const requestedAt = new Date();
  const cooldownCutoff = new Date(requestedAt.getTime() - RESEND_COOLDOWN_MS).toISOString();
  const { data: claimed, error: claimErr } = await service
    .from('ticket_orders')
    .update({ receipt_resend_last_requested_at: requestedAt.toISOString() })
    .eq('id', orderId)
    .eq('buyer_user_id', callerId)
    .eq('status', 'paid')
    .or(`receipt_resend_last_requested_at.is.null,receipt_resend_last_requested_at.lt.${cooldownCutoff}`)
    .select('id');
  if (claimErr) return json(500, { error: 'could not start the resend. give it another try.' });
  if (!claimed || claimed.length === 0) {
    return json(429, { error: 'a receipt was just requested. try again in a few minutes.' });
  }

  const [{ data: event }, { data: seats }] = await Promise.all([
    service.from('explore_events').select('title, event_date, venue, confirmation_message').eq('id', order.event_id).maybeSingle(),
    service.from('ticket_order_positions').select('position_index, reference_code, voided_at').eq('order_id', orderId).order('position_index', { ascending: true }),
  ]);

  const title = event?.title ?? 'your event';
  const whenWhere = [event?.event_date, event?.venue].filter(Boolean).join(' · ');
  const note = event?.confirmation_message ?? null;
  const total = order.total_cents === 0 ? 'free' : `$${(order.total_cents / 100).toFixed(2)}`;
  const refLines = ((seats ?? []) as { reference_code: string; voided_at: string | null }[])
    .filter((s) => !s.voided_at)
    .map((s) => s.reference_code);

  const subject = order.qty > 1 ? `your tickets to ${title}` : `your ticket to ${title}`;
  const text = [
    `here's your receipt again. ${title}${whenWhere ? ` (${whenWhere})` : ''}.`,
    '',
    refLines.length > 0
      ? `${order.qty > 1 ? 'tickets' : 'ticket'}: ${refLines.join(', ')}`
      : 'your tickets are on their way.',
    `total: ${total}`,
    ...(note ? ['', 'good to know:', note] : []),
    '',
    `your tickets live at ${WALLET_URL}`,
  ].join('\n');
  const noteHtml = note
    ? `<p style="margin:20px 0 6px;font-weight:700;color:#2C1810;">good to know</p>
       <p style="margin:0;color:#2C1810;white-space:pre-line;">${escapeHtml(note)}</p>`
    : '';
  const html = `
<div style="background:#FAF5EC;padding:32px 16px;font-family:-apple-system,'Segoe UI',sans-serif;color:#2C1810;">
  <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:16px;padding:28px;">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#B5522E;font-weight:600;">washedup</p>
    <h1 style="margin:0 0 4px;font-size:22px;">your receipt, again.</h1>
    <p style="margin:0 0 20px;color:#78695C;">${escapeHtml(title)}${whenWhere ? ` · ${escapeHtml(whenWhere)}` : ''}</p>
    ${refLines.length > 0 ? `<p style="margin:0 0 6px;font-weight:700;">${order.qty > 1 ? 'your tickets' : 'your ticket'}</p>
    ${refLines.map((r) => `<p style="margin:0;font-family:monospace;font-size:16px;font-weight:700;">${escapeHtml(r)}</p>`).join('')}` : ''}
    <p style="margin:16px 0 0;color:#78695C;">total: <span style="color:#2C1810;font-weight:700;">${total}</span></p>
    ${noteHtml}
    <a href="${WALLET_URL}" style="display:inline-block;margin-top:24px;background:#B5522E;color:#FFFFFF;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:700;">see your tickets</a>
  </div>
</div>`;

  let res: Response | null = null;
  try {
    res = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      timeoutMs: PROVIDER_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `ticket-receipt/${orderId}/${Math.floor(requestedAt.getTime() / RESEND_COOLDOWN_MS)}`,
      },
      body: JSON.stringify({ from: CONFIRMATION_FROM, to: [callerEmail], subject, html, text }),
    });
  } catch (err) {
    console.error('ticket-resend-receipt: resend unreachable', err instanceof Error ? err.message : 'unknown');
    return json(502, { error: 'that did not send. give it another try.' });
  }
  if (!res || !res.ok) {
    console.error('ticket-resend-receipt: resend refused', res?.status ?? 'unreachable');
    return json(502, { error: 'that did not send. give it another try.' });
  }
  return json(200, { ok: true });
});
