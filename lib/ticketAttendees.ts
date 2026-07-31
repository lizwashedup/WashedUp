/**
 * The organizer's seat-level attendee reader (spec 100 P0 #1, native's
 * read-only at-a-glance slice). Answers and orders are PER SEAT, so this reads
 * one row per ticket_order_positions row, never per order (spec 100).
 *
 * §7 data-handling law: every read is gated by RLS on is_ticketing_organizer,
 * so an organizer sees ONLY their own event. We surface buyer_name_snapshot and
 * nothing more of the buyer's PII, never email / phone / internal fields.
 */

import { supabase } from './supabase';

export interface DoorAttendee {
  positionId: string;
  /** the seat's order: what a refund call targets (doc 108) */
  orderId: string;
  positionIndex: number;
  referenceCode: string;
  buyerName: string;
  tierName: string | null;
  orderStatus: string;
  voided: boolean;
  refundedCents: number;
  checkedIn: boolean;
}

export interface AttendeeCounts {
  sold: number;
  checkedIn: number;
  refunded: number;
}

/**
 * One row per seat for an event, organizer-gated by RLS. A single embedded read:
 * positions -> their order (name, status, tier) and their check-ins. is_active
 * is not a concept here; a seat exists once the order settled.
 */
export async function getEventAttendees(eventId: string): Promise<DoorAttendee[]> {
  const { data, error } = await supabase
    .from('ticket_order_positions')
    .select(
      'id, position_index, reference_code, voided_at, refunded_cents, ' +
      'ticket_orders!inner ( id, event_id, buyer_name_snapshot, status, ticket_tiers ( name ) ), ' +
      'ticket_checkins ( result )',
    )
    .eq('ticket_orders.event_id', eventId)
    .order('position_index', { ascending: true });
  if (error) throw error;

  // supabase-js cannot infer the multi-embed row shape, so it widens to its
  // error type; the query is valid, so read the rows as untyped records
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((row) => {
    const order = row.ticket_orders as {
      id?: string;
      buyer_name_snapshot?: string;
      status?: string;
      ticket_tiers?: { name?: string } | null;
    } | null;
    const checkins = (row.ticket_checkins as { result?: string }[] | null) ?? [];
    return {
      positionId: row.id as string,
      orderId: order?.id ?? '',
      positionIndex: row.position_index as number,
      referenceCode: row.reference_code as string,
      buyerName: order?.buyer_name_snapshot?.trim() || 'guest',
      tierName: order?.ticket_tiers?.name ?? null,
      orderStatus: order?.status ?? 'pending',
      voided: row.voided_at != null,
      refundedCents: (row.refunded_cents as number) ?? 0,
      checkedIn: checkins.some((c) => c.result === 'admitted'),
    };
  });
}

/** A live seat is a paid, non-voided position; the door counts against these. */
export function isLiveSeat(a: DoorAttendee): boolean {
  return a.orderStatus === 'paid' && !a.voided;
}

export function countAttendees(list: DoorAttendee[]): AttendeeCounts {
  let sold = 0;
  let checkedIn = 0;
  let refunded = 0;
  for (const a of list) {
    if (a.refundedCents > 0 || a.voided) refunded += 1;
    if (isLiveSeat(a)) {
      sold += 1;
      if (a.checkedIn) checkedIn += 1;
    }
  }
  return { sold, checkedIn, refunded };
}
