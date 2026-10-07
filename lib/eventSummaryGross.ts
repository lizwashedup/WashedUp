import { supabase } from './supabase';
import type { CreatorPageScope } from './creatorPageReview';
import { canReadCreatorTickets, scopedTicketRequest } from './creatorTicketRead';
const PAGE_SIZE = 500;

/** Same paid-order face-value basis as the existing money screen. Fetch all
 * pages in stable order, without payout/provider data or buyer identities. */
export async function getEventSummaryGross(eventId: string, isCurrent: () => boolean = () => true, scope?: CreatorPageScope): Promise<number> {
  if (!eventId.trim()) throw new Error('An event is required.');
  if (scope && !await canReadCreatorTickets(eventId, scope)) throw new Error('Ticket sales access is unavailable.');
  let total = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    if (!isCurrent()) throw new Error('This account changed.');
    const { data, error } = await scopedTicketRequest(scope, () => supabase.from('ticket_orders')
      .select('id, face_cents').eq('event_id', eventId).eq('status', 'paid')
      .order('id', { ascending: true }).range(offset, offset + PAGE_SIZE - 1));
    if (!isCurrent()) throw new Error('This account changed.');
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Ticket sales are unavailable.');
    for (const row of data) {
      if (!row || !Number.isSafeInteger(row.face_cents) || row.face_cents < 0) throw new Error('Ticket sales are unavailable.');
      total += row.face_cents;
      if (!Number.isSafeInteger(total)) throw new Error('Ticket sales are unavailable.');
    }
    if (data.length < PAGE_SIZE) return total;
  }
}

/** Existing live-seat definition: paid, non-voided positions; an admitted
 * scan counts once per position. The overview never needs attendee names. */
export async function getEventSummaryTickets(eventId: string, isCurrent: () => boolean = () => true, scope?: CreatorPageScope): Promise<{ sold: number; checkedIn: number }> {
  if (!eventId.trim()) throw new Error('An event is required.');
  if (scope && !await canReadCreatorTickets(eventId, scope)) throw new Error('Ticket counts access is unavailable.');
  const counts = { sold: 0, checkedIn: 0 };
  for (let offset = 0; ; offset += PAGE_SIZE) {
    if (!isCurrent()) throw new Error('This account changed.');
    const { data, error } = await scopedTicketRequest(scope, () => supabase.from('ticket_order_positions')
      .select('id, voided_at, ticket_orders!inner ( status ), ticket_checkins ( result )')
      .eq('ticket_orders.event_id', eventId).eq('ticket_orders.status', 'paid')
      .order('id', { ascending: true }).range(offset, offset + PAGE_SIZE - 1));
    if (!isCurrent()) throw new Error('This account changed.');
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Ticket counts are unavailable.');
    for (const row of data as unknown as { id: string; voided_at: string | null; ticket_orders: { status: string }; ticket_checkins: { result: string }[] }[]) {
      if (!row || !row.id || row.ticket_orders?.status !== 'paid' || !Array.isArray(row.ticket_checkins) || row.ticket_checkins.some(scan => !scan || typeof scan.result !== 'string')) throw new Error('Ticket counts are unavailable.');
      if (row.voided_at != null) continue;
      counts.sold++;
      if (row.ticket_checkins.some(scan => scan.result === 'admitted')) counts.checkedIn++;
    }
    if (data.length < PAGE_SIZE) return counts;
  }
}
