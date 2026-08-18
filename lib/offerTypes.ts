/**
 * Flexible offer types (CTO scope item 9, 2026-08-17 working session).
 *
 * WHAT LIZ'S OWN DOCS ACTUALLY SPECIFY, no more:
 *   - Six named "promise types" a creator picks before setup, consistently
 *     named across the CTO scope doc, the Figma-ready build spec, and the
 *     Creator Space inventory (C-18): free event, ticketed event, a
 *     required multi-week course, drop-in, subscription, class pack.
 *   - "Type-specific fields appear only after selection" (C-18) -- but no
 *     field list is given for drop-in, class pack, or subscription anywhere
 *     in the source docs. Those are UNSPECIFIED beyond the label.
 *   - The ONE concrete new mechanic actually described: "A multi-session
 *     course represents the required series of dates and enrollment as one
 *     offer" (CTO scope item 9, USER_BEHAVIOR). That is a real, buildable
 *     behavior: a course is a set of required session dates purchased as a
 *     single unit through the existing ticket_tiers/checkout path.
 *   - OPEN_QUESTIONS (item 9): "Which offer types must ship in the first
 *     release versus follow later... Liz did not select an initial delivery
 *     order." So which of the six actually get real purchase mechanics is
 *     an open founder decision, not something to guess here.
 *
 * WHAT THIS FILE BUILDS: the six-value label set (so a creator picking a
 * promise type has a real, shared vocabulary the app can store), plus real
 * validation for the one mechanic that is actually specified -- a course's
 * required session series. drop_in and class_pack sell through the existing
 * single-tier purchase path unchanged (no new mechanic needed to represent
 * them structurally). subscription needs recurring billing Liz's docs never
 * describe (cadence, cancellation, proration) -- isOfferTypeSellableToday()
 * below marks it not sellable so a caller can gate it honestly instead of
 * pretending a one-time Stripe Checkout session is a subscription.
 */

export type OfferType =
  | 'free_event'
  | 'ticketed_event'
  | 'course'
  | 'drop_in'
  | 'class_pack'
  | 'subscription';

export interface OfferTypeOption {
  value: OfferType;
  /* copy to the taste gate */
  label: string;
}

/** The six types, in the order every source doc lists them (C-18, item 9). */
export const OFFER_TYPE_OPTIONS: OfferTypeOption[] = [
  { value: 'free_event', label: 'free event' },
  { value: 'ticketed_event', label: 'ticketed event' },
  { value: 'course', label: 'multi-week course' },
  { value: 'drop_in', label: 'drop-in' },
  { value: 'class_pack', label: 'class pack' },
  { value: 'subscription', label: 'membership' },
];

export function describeOfferType(type: OfferType): string {
  return OFFER_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

export function isOfferType(value: string): value is OfferType {
  return OFFER_TYPE_OPTIONS.some((o) => o.value === value);
}

/**
 * Only 'course' carries the new required-sessions mechanic (the one thing
 * item 9's USER_BEHAVIOR actually describes). Every other type sells through
 * the existing single ticket_tiers row unchanged.
 */
export function offerTypeRequiresSessions(type: OfferType): boolean {
  return type === 'course';
}

/**
 * Types with real, buildable purchase mechanics on today's ticketing model
 * (a buyer picks a tier, pays once, gets a seat -- free_event/ticketed_event
 * as-is, course as one unit across its required sessions, drop_in as a
 * single-occurrence tier with no new mechanic needed). class_pack (a bundle
 * of redeemable future credits) and subscription (recurring billing) both
 * need mechanics no source doc specifies -- they exist here as a real label
 * a creator can pick, but a caller must NOT let a checkout proceed against
 * either as if it were a one-time ticket sale.
 */
export function isOfferTypeSellableToday(type: OfferType): boolean {
  return type !== 'class_pack' && type !== 'subscription';
}

// ─── course sessions: "the required series of dates ... as one offer" ────

export interface OfferSessionDraft {
  /** ISO 8601 */
  start: string;
  /** ISO 8601, optional */
  end?: string | null;
}

export interface CourseSessionsValidation {
  ok: boolean;
  /* copy to the taste gate */
  message: string | null;
}

/** A course is a SERIES: one date is just a one-off event, not a course. */
export const COURSE_MIN_SESSIONS = 2;
export const COURSE_MAX_SESSIONS = 52;

/**
 * Validates a proposed session set for a course offer. Pure and
 * DB-independent so it can be unit-tested without a live Postgres, mirrored
 * server-side by the set_event_offer_sessions() RPC (draft migration
 * 20260818120000_flexible_offer_types.sql) -- keep the two in lockstep if
 * either changes.
 */
export function validateCourseSessions(sessions: OfferSessionDraft[]): CourseSessionsValidation {
  if (!Array.isArray(sessions) || sessions.length < COURSE_MIN_SESSIONS) {
    /* copy to the taste gate */
    return { ok: false, message: `a course needs at least ${COURSE_MIN_SESSIONS} dates.` };
  }
  if (sessions.length > COURSE_MAX_SESSIONS) {
    /* copy to the taste gate */
    return { ok: false, message: 'that is more dates than a single course can hold.' };
  }

  const starts = new Set<number>();
  for (const s of sessions) {
    const startMs = Date.parse(s.start);
    if (!Number.isFinite(startMs)) {
      /* copy to the taste gate */
      return { ok: false, message: 'one of those dates did not read as a real date.' };
    }
    if (s.end != null) {
      const endMs = Date.parse(s.end);
      if (!Number.isFinite(endMs)) {
        /* copy to the taste gate */
        return { ok: false, message: 'one of those end times did not read as a real date.' };
      }
      if (endMs <= startMs) {
        /* copy to the taste gate */
        return { ok: false, message: 'a session has to end after it starts.' };
      }
    }
    if (starts.has(startMs)) {
      /* copy to the taste gate */
      return { ok: false, message: 'two sessions land on the exact same start time.' };
    }
    starts.add(startMs);
  }

  return { ok: true, message: null };
}

/** Sorted ascending by start -- the display + storage order for a course's dates. */
export function sortSessions<T extends OfferSessionDraft>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/**
 * The overall span of a validated course, for display where the app still
 * only has room for one start/end (list rows, notifications). Returns null
 * on an empty or invalid set rather than guessing.
 */
export function courseDateRange(sessions: OfferSessionDraft[]): { firstStart: string; lastStart: string } | null {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  const sorted = sortSessions(sessions);
  return { firstStart: sorted[0].start, lastStart: sorted[sorted.length - 1].start };
}
