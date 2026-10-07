import { supabase } from './supabase';
import type { CheckoutOwner } from './ticketCheckoutAttempt';

export type CheckoutResumeResult =
  | { kind: 'checkout'; orderId: string; url: string }
  | { kind: 'updated'; orderId: string }
  | { kind: 'error'; message: string };
const pending = (): CheckoutResumeResult => ({ kind: 'error', message: 'This purchase is still being checked. Check its status again before starting another.' });

/** Original-order resume never sends a new key, price, promo or answers. */
export async function resumeTicketCheckout(orderId: string, owner: CheckoutOwner): Promise<CheckoutResumeResult> {
  if (!owner.userId || !owner.isCurrent() || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(orderId)) return pending();
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const session = sessionData?.session;
    if (!owner.isCurrent()) return pending();
    if (sessionError || session?.user.id !== owner.userId || !session?.access_token) {
      return { kind: 'error', message: 'Sign in with the account that started this purchase.' };
    }
    const { data, error } = await supabase.functions.invoke('create-ticket-checkout', {
      body: { order_id: orderId, return_mode: 'native' },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!owner.isCurrent()) return pending();
    if (error) {
      const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
      let receipt: { code?: string; order_id?: string } | null = null;
      try { receipt = context?.json ? await context.json() as { code?: string; order_id?: string } : null; } catch { /* retain uncertainty */ }
      if (!owner.isCurrent()) return pending();
      if (receipt?.code === 'checkout_expired' && receipt.order_id === orderId) return { kind: 'updated', orderId };
      if (receipt?.code === 'checkout_event_unavailable' && receipt.order_id === orderId) {
        return { kind: 'error', message: 'This event is not accepting payments. Your saved purchase is still here.' };
      }
      return pending();
    }
    if (data?.order_id !== orderId) return pending();
    if (data?.free === true || ['paid', 'canceled', 'refunded'].includes(data?.status)) return { kind: 'updated', orderId };
    if (typeof data?.url === 'string') {
      const url = new URL(data.url);
      if (url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' && !url.username && !url.password) {
        return { kind: 'checkout', orderId, url: url.href };
      }
    }
  } catch { /* no inferred cancellation or fresh purchase */ }
  return pending();
}
