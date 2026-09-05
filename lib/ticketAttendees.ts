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
import type { QuestionType, QuestionScope } from './ticketing';

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
  /** cents paid for this seat's tier (CSV export core column, web parity) */
  pricePaidCents: number;
  /** most recent ADMITTED scan time, if any (CSV export core column) */
  checkedInAt: string | null;
  /** the seat's order settlement time (CSV export core column) */
  purchasedAt: string | null;
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
      'ticket_orders!inner ( id, event_id, buyer_name_snapshot, status, unit_face_cents, paid_at, ticket_tiers ( name ) ), ' +
      'ticket_checkins ( result, scanned_at )',
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
      unit_face_cents?: number;
      paid_at?: string | null;
      ticket_tiers?: { name?: string } | null;
    } | null;
    const checkins = (row.ticket_checkins as { result?: string; scanned_at?: string }[] | null) ?? [];
    // most recent ADMITTED scan wins, kept consistent with this function's own
    // checkedIn gate just below (result === 'admitted') -- web's equivalent
    // (organizerData.ts:376-382) takes the latest scan of ANY result, a looser
    // definition this file does not otherwise use.
    const admitted = checkins
      .filter((c) => c.result === 'admitted')
      .sort((a, b) => (b.scanned_at ?? '').localeCompare(a.scanned_at ?? ''))[0];
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
      pricePaidCents: order?.unit_face_cents ?? 0,
      checkedInAt: admitted?.scanned_at ?? null,
      purchasedAt: order?.paid_at ?? null,
    };
  });
}

/** A live seat is a paid, non-voided position; the door counts against these. */
export function isLiveSeat(a: DoorAttendee): boolean {
  return a.orderStatus === 'paid' && !a.voided;
}

/**
 * Refund total for the money summary, scoped to positions whose order is
 * still 'paid'. getEventMoneySummary already excludes non-'paid' orders from
 * gross/commission, so a FULLY refunded order (status flipped to 'refunded')
 * contributes nothing to gross — subtracting its positions' refunded_cents
 * again double-counted the refund and understated net-to-you. Mirrors
 * getPayoutSummary (lib/ticketing.ts), which only ever reads positions
 * belonging to 'paid' orders and therefore never had this distortion.
 */
export function sumRefundedCentsOnPaidOrders(list: DoorAttendee[]): number {
  return list.reduce(
    (s, a) => (a.orderStatus === 'paid' ? s + a.refundedCents : s),
    0,
  );
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

export interface EventMoneySummary {
  grossFaceCents: number;
  processingCents: number;
  commissionCents: number;
  payoutStatus: string | null;
  payoutReleasedAt: string | null;
  payoutPaidAt: string | null;
}

/**
 * Per-event money summary for the organizer (parity gap O-06; web's
 * getEventAttendeeData / MoneySummaryCard is the reference, src/lib/
 * communities/organizerData.ts). ticketsSold and refundedCents are NOT
 * recomputed here -- the caller (attendees.tsx) already has them from
 * getEventAttendees/countAttendees on the same screen; this only queries
 * the two tables that screen doesn't already load. §7: only face_cents /
 * processing_cents / commission_cents are selected -- commission_bps_applied
 * and any stripe_* column are never read here, matching organizerData.ts's
 * own column-projection rule.
 */
export async function getEventMoneySummary(eventId: string): Promise<EventMoneySummary> {
  const empty: EventMoneySummary = {
    grossFaceCents: 0, processingCents: 0, commissionCents: 0,
    payoutStatus: null, payoutReleasedAt: null, payoutPaidAt: null,
  };
  const [{ data: orderRows, error: orderErr }, { data: payoutRow }] = await Promise.all([
    supabase
      .from('ticket_orders')
      .select('face_cents, processing_cents, commission_cents, status')
      .eq('event_id', eventId),
    // ticket_payouts_one_per_event UNIQUE(event_id) (confirmed live in
    // supabase/migrations/20260816120000_claim_ticket_payout_batch_atomic.sql)
    // -- at most one row, so maybeSingle() is correct, no order/limit needed.
    supabase
      .from('ticket_payouts')
      .select('status, released_at, paid_at')
      .eq('event_id', eventId)
      .maybeSingle(),
  ]);
  if (orderErr) return empty;
  const paid = ((orderRows ?? []) as {
    face_cents: number | null; processing_cents: number | null; commission_cents: number | null; status: string;
  }[]).filter((o) => o.status === 'paid');
  return {
    grossFaceCents: paid.reduce((s, o) => s + (o.face_cents ?? 0), 0),
    processingCents: paid.reduce((s, o) => s + (o.processing_cents ?? 0), 0),
    commissionCents: paid.reduce((s, o) => s + (o.commission_cents ?? 0), 0),
    payoutStatus: (payoutRow as { status?: string } | null)?.status ?? null,
    payoutReleasedAt: (payoutRow as { released_at?: string | null } | null)?.released_at ?? null,
    payoutPaidAt: (payoutRow as { paid_at?: string | null } | null)?.paid_at ?? null,
  };
}

// ─── Screen 54 addendum (2026-09-05 spec §5): organizer-side questionnaire
// answers, native's one real gap vs. web. Kept as separate reads from
// getEventAttendees above (not folded into its query) so screens that never
// show answers -- check-in, event money, the reconciliation rollup -- never
// pay for two extra queries per event. Mirrors web's organizerData.ts
// (BR-1/BR-2/BR-3).

export interface AttendeeQuestion {
  id: string;
  prompt: string;
  qtype: QuestionType;
  scope: QuestionScope;
  sortOrder: number;
}

/** Fixed answer-value shapes (Cowork 2026-07-26), mirrors web's answerToString (organizerData.ts:124-143). */
export function answerToString(qtype: QuestionType, value: unknown): string {
  if (value == null || typeof value !== 'object') return '';
  const v = value as Record<string, unknown>;
  switch (qtype) {
    case 'short_text':
    case 'paragraph':
      return typeof v.text === 'string' ? v.text : '';
    case 'single_select':
    case 'dropdown':
      return typeof v.choice === 'string' ? v.choice : '';
    case 'multi_select':
      return Array.isArray(v.choices) ? (v.choices as unknown[]).filter((c) => typeof c === 'string').join(', ') : '';
    case 'terms':
      return v.accepted
        ? `accepted${typeof v.accepted_at === 'string' ? ` ${v.accepted_at}` : ''}`
        : 'not accepted';
    default:
      return '';
  }
}

/**
 * BR-2: only active questions, ordered for display -- the response-review
 * reader. A separate purpose from ticketing.ts's getQuestions() (question
 * authoring): same table, same is_active filter, same precedent this repo
 * already has for two readers of one table serving two different jobs.
 */
export async function getEventQuestions(eventId: string): Promise<AttendeeQuestion[]> {
  const { data, error } = await supabase
    .from('ticket_questions')
    .select('id, prompt, qtype, scope, sort_order')
    .eq('event_id', eventId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) return [];
  return (data ?? []).map((q: any) => ({
    id: q.id as string,
    prompt: q.prompt as string,
    qtype: q.qtype as QuestionType,
    scope: q.scope as QuestionScope,
    sortOrder: q.sort_order as number,
  }));
}

export interface RawTicketAnswer {
  orderId: string;
  questionId: string;
  attendeeIndex: number | null;
  value: unknown;
}

/**
 * Raw ticket_answers rows for a set of orders. Callers attach them to seats
 * via attachAnswers() below -- kept separate so it's a no-op (no network
 * call) for an event with no active questions, see attendees.tsx's enabled
 * gate.
 */
export async function getEventAnswers(orderIds: string[]): Promise<RawTicketAnswer[]> {
  if (orderIds.length === 0) return [];
  const { data, error } = await supabase
    .from('ticket_answers')
    .select('order_id, question_id, attendee_index, value')
    .in('order_id', orderIds);
  if (error) return [];
  return (data ?? []).map((r: any) => ({
    orderId: r.order_id as string,
    questionId: r.question_id as string,
    attendeeIndex: r.attendee_index as number | null,
    value: r.value,
  }));
}

export interface DoorAttendeeWithAnswers extends DoorAttendee {
  /** this seat's answers, keyed by question id, already stringified */
  answers: Record<string, string>;
}

/**
 * BR-1 (answer scoping), pure and synchronous: a per_attendee answer belongs
 * to the one seat whose position_index matches the answer's attendee_index; a
 * per_order answer (attendee_index null) belongs to every seat of that order.
 * Mirrors web's getEventAttendeeData (organizerData.ts:424-437) exactly.
 */
export function attachAnswers(
  attendees: DoorAttendee[],
  questions: AttendeeQuestion[],
  answerRows: RawTicketAnswer[],
): DoorAttendeeWithAnswers[] {
  const qById = new Map(questions.map((q) => [q.id, q]));
  return attendees.map((a) => {
    const answers: Record<string, string> = {};
    for (const row of answerRows) {
      if (row.orderId !== a.orderId) continue;
      const q = qById.get(row.questionId);
      if (!q) continue;
      const wanted = q.scope === 'per_attendee' ? a.positionIndex : null;
      if (row.attendeeIndex !== wanted) continue;
      answers[q.id] = answerToString(q.qtype, row.value);
    }
    return { ...a, answers };
  });
}
