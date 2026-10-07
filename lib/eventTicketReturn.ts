import { supabase } from './supabase';
import { assertTicketVisit, scopedTicketRequest } from './creatorTicketRead';
import type { CreatorPageScope } from './creatorPageReview';

/** A buyer's active seats remain distinct from free RSVPs and community membership. */
export async function readEventTicketReturn(eventId: string, scope: CreatorPageScope): Promise<{ orderId: string; quantity: number } | null> {
  assertTicketVisit(scope);
  if (!scope.userId || !eventId) throw new Error('Your tickets could not be checked.');
  const { data, error } = await scopedTicketRequest(scope, () => supabase.from('ticket_orders')
    // The holder column belongs to the separately gated transfer migration.
    // Read the buyer-owned seat record so its absence remains compatible with
    // current installations, while honoring the holder when that schema exists.
    .select('id,ticket_order_positions(*)')
    .eq('event_id', eventId).eq('buyer_user_id', scope.userId).eq('status', 'paid')
    .order('created_at', { ascending: false }), 12000);
  if (error || !Array.isArray(data)) throw new Error('Your tickets could not be checked.');
  for (const order of data) {
    if (typeof order.id !== 'string' || !Array.isArray(order.ticket_order_positions)) throw new Error('Your tickets could not be checked.');
    const seats = order.ticket_order_positions.filter(seat => typeof seat.id === 'string' && seat.voided_at === null
      && (!seat.current_holder_user_id || seat.current_holder_user_id === scope.userId));
    if (seats.length) return { orderId: order.id, quantity: seats.length };
  }
  return null;
}
