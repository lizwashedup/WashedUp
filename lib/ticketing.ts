/**
 * Organizer-side ticketing client (doc 61; proposals 64 + 65 applied,
 * 70 pending its re-cut). Tiers are direct table ops under 65's RLS
 * (is_ticketing_organizer gates writes server-side). The Stripe account
 * row is READ-ONLY here - writes are service-role only, through the
 * onboarding edge function and the webhook inbox drain (64's law).
 *
 * The FAQ half is SELF-FLIPPING in the house canon: proposal 70 is not
 * applied, so event_faqs does not exist and the editor stays dormant
 * (available:false); it wakes on the re-cut apply with no client deploy.
 */

import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

/** PostgREST "relation does not exist": the proposal is not applied. */
function isMissingSchema(code: string | undefined): boolean {
  return code === '42P01' || code === 'PGRST205';
}

// ─── the §3 money math ───────────────────────────────────────────────────
// Normative formula (doc 61 §3): commission C = round(F × bps / 10000);
// buyer total T = (F + 30) / (1 − 0.029), rounded UP to the cent.
// Cowork ruling 2026-07-21: the formula is the law (the §3 table was
// wrong and has been corrected). Checkout must match this to the cent.
export const STRIPE_FIXED_FEE_CENTS = 30;
export const STRIPE_RATE = 0.029;
// founding partner default; the organizer's locked row bps wins when readable
export const FALLBACK_COMMISSION_BPS = 400;

export interface FeePreview {
  faceCents: number;
  buyerTotalCents: number;
  processingCents: number;
  commissionCents: number;
  organizerCents: number;
}

export function computeFeePreview(faceCents: number, commissionBps: number): FeePreview {
  if (faceCents <= 0) {
    return { faceCents: 0, buyerTotalCents: 0, processingCents: 0, commissionCents: 0, organizerCents: 0 };
  }
  const commissionCents = Math.round((faceCents * commissionBps) / 10000);
  const buyerTotalCents = Math.ceil((faceCents + STRIPE_FIXED_FEE_CENTS) / (1 - STRIPE_RATE));
  return {
    faceCents,
    buyerTotalCents,
    processingCents: buyerTotalCents - faceCents,
    commissionCents,
    organizerCents: faceCents - commissionCents,
  };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// 65's CHECK constraints, mirrored so the form can explain them
export const TIER_MIN_PAID_CENTS = 500;
export const TIER_MAX_CENTS = 1000000;
export const TIER_NAME_MAX = 80;
export const TIER_DESCRIPTION_MAX = 500;

// ─── ticket tiers (proposal 65, applied) ─────────────────────────────────

export type TierVisibility = 'visible' | 'hidden' | 'scheduled';
export type TierStatus = 'draft' | 'on_sale' | 'closed';

export interface TicketTier {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  quantity_cap: number | null;
  per_order_min: number;
  per_order_max: number | null;
  sales_open_at: string | null;
  sales_close_at: string | null;
  opens_after_tier_id: string | null;
  visibility: TierVisibility;
  status: TierStatus;
  sort_order: number;
}

const TIER_COLUMNS =
  'id, event_id, name, description, price_cents, quantity_cap, per_order_min, per_order_max, sales_open_at, sales_close_at, opens_after_tier_id, visibility, status, sort_order';

export async function getTiers(eventId: string): Promise<TicketTier[]> {
  const { data, error } = await supabase
    .from('ticket_tiers')
    .select(TIER_COLUMNS)
    .eq('event_id', eventId)
    .order('sort_order', { ascending: true });
  if (error) return [];
  return (data ?? []) as TicketTier[];
}

export interface TierDraft {
  name: string;
  description: string | null;
  price_cents: number;
  quantity_cap: number | null;
  /** doc 109 (group tickets): 1 = no minimum; the column is NOT NULL */
  per_order_min: number;
  per_order_max: number | null;
  visibility: TierVisibility;
  status: TierStatus;
}

export async function createTier(
  eventId: string,
  draft: TierDraft,
  sortOrder: number,
): Promise<{ ok: boolean; message: string | null }> {
  const { error } = await supabase.from('ticket_tiers').insert({
    event_id: eventId,
    ...draft,
    sort_order: sortOrder,
  });
  return { ok: !error, message: error?.message ?? null };
}

export async function updateTier(
  tierId: string,
  patch: Partial<TierDraft>,
): Promise<{ ok: boolean; message: string | null }> {
  const { error } = await supabase.from('ticket_tiers').update(patch).eq('id', tierId);
  return { ok: !error, message: error?.message ?? null };
}

export async function deleteTier(tierId: string): Promise<boolean> {
  const { error } = await supabase.from('ticket_tiers').delete().eq('id', tierId);
  return !error;
}

// ─── the organizer's Stripe account (proposal 64, applied; read-only) ────

export interface PayoutState {
  exists: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  commissionBps: number;
  /** human labels for what Stripe still needs (currently_due + past_due) */
  requirementsDue: string[];
}

/**
 * requirements_due stores the FULL Stripe `requirements` object (the drain
 * writes `obj.requirements ?? {}` on account.updated, read 2026-07-27), so
 * the outstanding items are its currently_due + past_due string arrays.
 * Read defensively: the column can be {}, or an older row could hold a bare
 * array; anything unrecognized yields [].
 */
function extractDueKeys(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const lists = Array.isArray(raw)
    ? [raw]
    : [(raw as { past_due?: unknown }).past_due, (raw as { currently_due?: unknown }).currently_due];
  const keys = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const k of list) if (typeof k === 'string' && k) keys.add(k);
  }
  return [...keys];
}

/**
 * A Stripe requirement key ("individual.verification.document"), said like a
 * person. Substring-matched against the known shapes Express onboarding
 * actually asks for; the fallback humanizes the key's last segment so an
 * unmapped requirement still names itself instead of vanishing into a vague
 * sentence. All labels are LIZ COPY at the taste gate.
 */
export function describeStripeRequirement(key: string): string {
  const k = key.toLowerCase();
  /* copy to the taste gate: every label below */
  if (k.includes('external_account')) return 'a bank account for payouts';
  if (k.includes('verification.additional_document')) return 'one more verification document';
  if (k.includes('verification.document')) return 'a photo id';
  if (k.includes('id_number') || k.includes('ssn_last_4')) return 'an id number (like an ssn)';
  if (k.includes('.dob')) return 'date of birth';
  if (k.includes('.address')) return 'a mailing address';
  if (k.includes('first_name') || k.includes('last_name')) return 'legal name';
  if (k.includes('.email')) return 'an email address';
  if (k.includes('.phone')) return 'a phone number';
  if (k.includes('tos_acceptance')) return "agreeing to stripe's terms";
  if (k.includes('business_profile.url')) return 'a website or social link';
  if (k.includes('business_profile.mcc') || k.includes('business_profile.product_description')) {
    return 'what kind of thing you sell';
  }
  if (k.includes('business_type')) return 'individual or company';
  const last = key.replace(/\[\d+\]/g, '').split('.').pop() ?? key;
  return last.replace(/_/g, ' ');
}

export async function getMyPayoutState(userId: string): Promise<PayoutState> {
  const { data, error } = await supabase
    .from('organizer_stripe_accounts')
    .select('charges_enabled, payouts_enabled, details_submitted, commission_bps, requirements_due')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) {
    return {
      exists: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      commissionBps: FALLBACK_COMMISSION_BPS,
      requirementsDue: [],
    };
  }
  // dedupe after labeling: two keys can share one human label
  const labels = [...new Set(extractDueKeys(data.requirements_due).map(describeStripeRequirement))];
  return {
    exists: true,
    chargesEnabled: !!data.charges_enabled,
    payoutsEnabled: !!data.payouts_enabled,
    detailsSubmitted: !!data.details_submitted,
    commissionBps: data.commission_bps ?? FALLBACK_COMMISSION_BPS,
    requirementsDue: labels,
  };
}

/**
 * The selling gate (7-27 brief P3): publish and on_sale both require BOTH
 * Stripe capabilities. details_submitted alone is not readiness; an account
 * can submit details and still have either capability withheld.
 */
export function isPayoutReady(p: PayoutState | null | undefined): boolean {
  return !!p && p.chargesEnabled && p.payoutsEnabled;
}

/**
 * True when the event has at least one paid tier, the publish-gate input.
 * THROWS on a failed read rather than guessing: the gate fails closed
 * (a publish blocked by a flaky read is recoverable; paid tickets live
 * without payout rails are not). Free-only events never gate: free checkout
 * settles without Stripe ("free means free").
 */
export async function eventHasPaidTier(eventId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('ticket_tiers')
    .select('id')
    .eq('event_id', eventId)
    .gt('price_cents', 0)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

// The onboarding edge function name is Cowork's ruling (2026-07-21):
// the ticketing lane deploys to this exact slug.
export const ONBOARDING_EDGE_FN = 'ticket-connect-onboarding';

export async function requestOnboardingLink(): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke(ONBOARDING_EDGE_FN, { body: {} });
    if (error) return null;
    return typeof data?.url === 'string' ? data.url : null;
  } catch {
    return null;
  }
}

// ─── event FAQs (proposal 70, NOT applied - dormant until the re-cut) ────

export const FAQ_QUESTION_MAX = 300;
export const FAQ_ANSWER_MAX = 2000;

export interface EventFaq {
  id: string;
  event_id: string;
  question: string;
  answer: string;
  sort_order: number;
  is_active: boolean;
}

export async function getEventFaqs(
  eventId: string,
): Promise<{ available: boolean; faqs: EventFaq[] }> {
  const { data, error } = await supabase
    .from('event_faqs')
    .select('id, event_id, question, answer, sort_order, is_active')
    .eq('event_id', eventId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) {
    return { available: !isMissingSchema(error.code), faqs: [] };
  }
  return { available: true, faqs: (data ?? []) as EventFaq[] };
}

export async function createEventFaq(
  eventId: string,
  question: string,
  answer: string,
  sortOrder: number,
): Promise<boolean> {
  const { error } = await supabase.from('event_faqs').insert({
    event_id: eventId,
    question,
    answer,
    sort_order: sortOrder,
  });
  return !error;
}

export async function updateEventFaq(
  faqId: string,
  patch: { question?: string; answer?: string; is_active?: boolean },
): Promise<boolean> {
  const { error } = await supabase.from('event_faqs').update(patch).eq('id', faqId);
  return !error;
}

// ─── F5: tier count law, buyer questions, refund presets ─────────────────

/** doc 78 law 11 (Iyengar-Lepper): more options measurably reduce sales. */
export const TIER_COUNT_MAX = 4;
export const TIER_COUNT_RECOMMENDED = 3;
/**
 * Law 11 also wants ONE tier marked "most popular". The real marker is
 * an is_recommended column (proposal 85, ruled 2026-07-22: a MISLABELED
 * "most popular" is worse than none, so sort-order convention is INTERIM
 * only). Until 85 applies, the lowest-sorted on-sale tier stands in; the
 * moment the column lands, prefer a tier flagged is_recommended and fall
 * back to this convention only when none is flagged.
 */
export function recommendedTierId(tiers: TicketTier[]): string | null {
  const flagged = tiers.find((t) => (t as { is_recommended?: boolean }).is_recommended);
  if (flagged) return flagged.id;
  const onSale = tiers.filter((t) => t.status === 'on_sale' && t.visibility !== 'hidden');
  const pool = onSale.length > 0 ? onSale : tiers;
  return pool.length > 1 ? pool[0].id : null;
}

// buyer questions (proposal 66, applied)
export const QUESTIONS_MAX = 11; // Liz's ruling
export const QUESTION_PROMPT_MAX = 500;
export const QUESTION_OPTIONS_MAX = 50;
export type QuestionType =
  | 'short_text' | 'paragraph' | 'multi_select'
  | 'single_select' | 'dropdown' | 'terms';
export type QuestionScope = 'per_order' | 'per_attendee';
/** the three types that REQUIRE an options array (66's CHECK) */
export const QUESTION_TYPES_WITH_OPTIONS: QuestionType[] = ['multi_select', 'single_select', 'dropdown'];

export interface TicketQuestion {
  id: string;
  event_id: string;
  prompt: string;
  qtype: QuestionType;
  options: string[] | null;
  required: boolean;
  scope: QuestionScope;
  sort_order: number;
}

export async function getQuestions(eventId: string): Promise<TicketQuestion[]> {
  const { data, error } = await supabase
    .from('ticket_questions')
    .select('id, event_id, prompt, qtype, options, required, scope, sort_order')
    .eq('event_id', eventId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) return [];
  return (data ?? []) as TicketQuestion[];
}

export async function createQuestion(
  eventId: string,
  q: { prompt: string; qtype: QuestionType; options: string[] | null; required: boolean; scope: QuestionScope },
  sortOrder: number,
): Promise<{ ok: boolean; message: string | null }> {
  // mirror 66's CHECK client-side so the organizer gets a sentence, not a
  // constraint name
  const needsOptions = QUESTION_TYPES_WITH_OPTIONS.includes(q.qtype);
  if (needsOptions && (!q.options || q.options.length < 1)) {
    /* copy to the taste gate */
    return { ok: false, message: 'that kind of question needs at least one choice.' };
  }
  const { error } = await supabase.from('ticket_questions').insert({
    event_id: eventId,
    prompt: q.prompt.slice(0, QUESTION_PROMPT_MAX),
    qtype: q.qtype,
    options: needsOptions ? q.options : null,
    required: q.required,
    scope: q.scope,
    sort_order: sortOrder,
  });
  return { ok: !error, message: error?.message ?? null };
}

export async function updateQuestion(
  questionId: string,
  q: { prompt: string; qtype: QuestionType; options: string[] | null; required: boolean; scope: QuestionScope },
): Promise<{ ok: boolean; message: string | null }> {
  const needsOptions = QUESTION_TYPES_WITH_OPTIONS.includes(q.qtype);
  if (needsOptions && (!q.options || q.options.length < 1)) {
    /* copy to the taste gate */
    return { ok: false, message: 'that kind of question needs at least one choice.' };
  }
  const { error } = await supabase
    .from('ticket_questions')
    .update({
      prompt: q.prompt.slice(0, QUESTION_PROMPT_MAX),
      qtype: q.qtype,
      options: needsOptions ? q.options : null,
      required: q.required,
      scope: q.scope,
      updated_at: new Date().toISOString(),
    })
    .eq('id', questionId);
  return { ok: !error, message: error?.message ?? null };
}

export async function retireQuestion(questionId: string): Promise<boolean> {
  const { error } = await supabase
    .from('ticket_questions')
    .update({ is_active: false })
    .eq('id', questionId);
  return !error;
}

/** the six types in §3.8 order, with warm picker labels (LIZ COPY). */
export const QUESTION_TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: 'short_text', label: 'short answer' },
  { value: 'paragraph', label: 'long answer' },
  { value: 'single_select', label: 'pick one' },
  { value: 'multi_select', label: 'pick many' },
  { value: 'dropdown', label: 'dropdown' },
  { value: 'terms', label: 'agree to terms' },
];

export function questionTypeLabel(t: QuestionType): string {
  return QUESTION_TYPE_OPTIONS.find((x) => x.value === t)?.label ?? t;
}

// refund presets (doc 61 section 10.2; explore_events.refund_policy is text)
export interface RefundPreset {
  key: string;
  label: string;
  body: string;
}
/* copy to the taste gate */
export const REFUND_PRESETS: RefundPreset[] = [
  {
    key: 'full_7',
    label: 'full refund up to 7 days before',
    body: 'full refund up to 7 days before the event. after that, tickets are final.',
  },
  {
    key: 'full_24h',
    label: 'full refund up to 24 hours before',
    body: 'full refund up to 24 hours before the event. after that, tickets are final.',
  },
  {
    key: 'final',
    label: 'all sales final',
    body: 'all sales are final. if we cancel, you are refunded in full.',
  },
];

/**
 * NOT WRITABLE YET, and deliberately not faked. explore_events carries
 * refund_policy, but the ONLY update policy on that table is
 * admin-scoped and operator_update_explore_event has no
 * p_refund_policy param - so a direct column write silently no-ops for
 * every real organizer while appearing to succeed on an admin account.
 * That is the same class of bug the rich body hit twice; it needs an RPC
 * param as a numbered proposal, not a client workaround. The presets
 * above are ready to wire the moment the door exists.
 */
export const REFUND_POLICY_WRITE_BLOCKED = true;
// The writer wires the moment proposal 84 (p_refund_policy on the
// operator RPC, launch priority) lands - built against its APPLIED bytes,
// not pre-guessed. Deliberately NOT pre-written: refund_policy rides the
// full-overwrite RPC, so a two-arg convenience caller would null
// title/date/venue - the exact trap this whole class keeps setting. The
// real wiring adds refund_policy to the form's complete field set (the
// way description_blocks already rides it), once the param exists.

// ─── P3: the public price-from + honest scarcity (laws 9, 10) ────────────

export interface PublicTicketSummary {
  /** any on-sale, visible, still-available tier exists */
  onSale: boolean;
  /** the LOWEST all-in price among AVAILABLE tiers, in cents. Law 9: a
   *  sold-out tier never sets the headline number, so sold-out tiers are
   *  excluded from this min. Null when nothing is buyable. */
  fromCents: number | null;
  /** every buyable tier is sold out (show "sold out", never a price) */
  allSoldOut: boolean;
  /** real remaining inventory on the cheapest available tier, when that
   *  tier is capped. Law 10: this comes from get_ticket_tier_availability
   *  (real orders + holds), NEVER a countdown. Null = uncapped or unknown. */
  scarcity: { left: number; cap: number } | null;
}

export async function getPublicTicketSummary(eventId: string): Promise<PublicTicketSummary> {
  const empty: PublicTicketSummary = { onSale: false, fromCents: null, allSoldOut: false, scarcity: null };
  const { data, error } = await supabase
    .from('ticket_tiers')
    .select('id, price_cents, quantity_cap, status, visibility')
    .eq('event_id', eventId)
    .eq('status', 'on_sale')
    .neq('visibility', 'hidden')
    .order('price_cents', { ascending: true });
  if (error || !data || data.length === 0) return empty;

  // real availability per tier (definer RPC; fail-closed to "unknown", not
  // to a made-up number)
  const withAvail = await Promise.all(
    data.map(async (tier) => {
      const { data: left } = await supabase.rpc('get_ticket_tier_availability', { p_tier_id: tier.id });
      const remaining = typeof left === 'number' ? left : null;
      const soldOut = tier.quantity_cap !== null && remaining !== null && remaining <= 0;
      return { tier, remaining, soldOut };
    }),
  );

  const available = withAvail.filter((r) => !r.soldOut);
  if (available.length === 0) {
    return { onSale: false, fromCents: null, allSoldOut: true, scarcity: null };
  }

  // cheapest AVAILABLE tier sets the headline (law 9), by all-in buyer
  // total - the buyer total is independent of commission (processing only)
  const cheapest = available.reduce((lo, r) =>
    computeFeePreview(r.tier.price_cents, 0).buyerTotalCents <
    computeFeePreview(lo.tier.price_cents, 0).buyerTotalCents ? r : lo,
  );
  const fromCents = computeFeePreview(cheapest.tier.price_cents, 0).buyerTotalCents;

  // real scarcity, only when the cheapest tier is capped and the count is
  // known (law 10)
  const scarcity =
    cheapest.tier.quantity_cap !== null && cheapest.remaining !== null
      ? { left: cheapest.remaining, cap: cheapest.tier.quantity_cap }
      : null;

  return { onSale: true, fromCents, allSoldOut: false, scarcity };
}

// ─── C1: the buyer's checkout handoff (mirror of web; contract = the ────
//        create-ticket-checkout edge function, the source of truth) ──────

export type CheckoutResult =
  | { kind: 'paid'; url: string; orderId: string }
  | { kind: 'free'; orderId: string }
  | { kind: 'error'; message: string };

/**
 * Calls create-ticket-checkout (verify_jwt: the signed-in buyer). The edge
 * fn runs begin_ticket_checkout (proposal 87: §3 math + hold claim + pending
 * order under the event lock) and returns either a hosted Stripe Checkout
 * url (paid) or an immediate free confirmation. TEST MODE until Liz's live
 * word - the fn hard-refuses a non-test key, surfaced here as a plain note.
 */
/**
 * Never show a buyer a raw server string. The checkout path leaks Postgres and
 * PostgREST text ("Could not find the function ... in the schema cache",
 * "insufficient availability (0 left)", raw UUIDs from settle_ticket_hold). Map
 * the handful of buyer-meaningful cases to warm copy; everything else (schema
 * cache, raw pg, uuids, nulls, permission) collapses to one safe line.
 */
function humanCheckoutError(raw: string | null | undefined): string {
  const s = (raw ?? '').toLowerCase();
  if (/(sold out|availability|no tickets|\bleft\b|unavailable)/.test(s)) return 'there are not that many tickets left.';
  if (/(per[ -]?order|limit|maximum|too many)/.test(s)) return 'that is more than you can buy in one order.';
  if (/(not on sale|sales? (have )?ended|closed|not available)/.test(s)) return 'these tickets are not on sale right now.';
  if (/(sign|auth|not signed)/.test(s)) return 'sign in to get tickets.';
  // schema cache / raw pg / uuids / anything unrecognized never reaches a buyer
  return 'checkout could not start. give it a moment and try again.';
}

export async function startTicketCheckout(
  tierId: string,
  qty: number,
  // docs 113/114 (canon): promo + add-ons ride the same call under the
  // canon body keys. Both travel only when provided, so a checkout without
  // them is byte-identical to today's.
  extras?: { promoCode?: string | null; addons?: { add_on_id: string; qty: number }[] },
): Promise<CheckoutResult> {
  // 87 F1 idempotency (Cowork 7-27): ONE stable checkout_key per user
  // checkout action, minted here because one call IS one action today (the
  // sheet's tap runs a single invoke, no auto-retry). A new tap = a new
  // key by construction. If retry logic is ever added, it belongs INSIDE
  // this function, reusing this same key. v7 of the edge fn ignores the
  // field; v8 passes it to begin_ticket_checkout so a retried action lands
  // on one hold and one order.
  const checkoutKey = Crypto.randomUUID();
  const body: Record<string, unknown> = {
    // origin drives the Stripe success/cancel return; the fn allow-lists it
    tier_id: tierId, qty, origin: 'https://washedup.app', checkout_key: checkoutKey,
  };
  if (extras?.promoCode) body.promo_code = extras.promoCode;
  if (extras?.addons && extras.addons.length > 0) body.add_ons = extras.addons;
  const { data, error } = await supabase.functions.invoke('create-ticket-checkout', { body });
  if (error) {
    // functions.invoke surfaces non-2xx as an error with the JSON body. That
    // body can be a curated reason OR raw Postgres; sanitize either way so no
    // schema-cache / uuid text ever reaches the buyer.
    const ctx = (error as { context?: { body?: unknown } }).context;
    let raw: string | null = null;
    try {
      const parsed = typeof ctx?.body === 'string' ? JSON.parse(ctx.body) : ctx?.body;
      if (parsed && typeof (parsed as { error?: string }).error === 'string') {
        raw = (parsed as { error: string }).error;
      }
    } catch { /* raw stays null */ }
    return { kind: 'error', message: humanCheckoutError(raw ?? error.message) };
  }
  if (data?.free && data?.order_id) return { kind: 'free', orderId: data.order_id };
  if (data?.url && data?.order_id) return { kind: 'paid', url: data.url, orderId: data.order_id };
  return { kind: 'error', message: 'checkout could not start. try again.' };
}

// ─── C2/C3: the buyer's orders + answers (own-rows RLS) ──────────────────

/**
 * One seat of an order. reference_code is what the door checks
 * (record_ticket_checkin) and what the wallet renders as the QR; the order id
 * is never a ticket code. Positions are created at settle (settle_ticket_hold),
 * so a 'paid' order always has them; a still-pending paid checkout does not.
 */
export interface MySeat {
  id: string;
  position_index: number;
  reference_code: string;
  voided: boolean;
}

export interface MyOrder {
  id: string;
  event_id: string;
  qty: number;
  total_cents: number;
  status: string;
  created_at: string;
  event_title: string | null;
  event_date: string | null;
  seats: MySeat[];
}

const ORDER_SELECT =
  'id, event_id, qty, total_cents, status, created_at, explore_events(title, event_date), ' +
  'ticket_order_positions(id, position_index, reference_code, voided_at)';

function mapSeats(o: Record<string, unknown>): MySeat[] {
  const rows = (o.ticket_order_positions as {
    id: string; position_index: number; reference_code: string; voided_at: string | null;
  }[] | null) ?? [];
  return rows
    .map((p) => ({
      id: p.id,
      position_index: p.position_index,
      reference_code: p.reference_code,
      voided: p.voided_at != null,
    }))
    .sort((a, b) => a.position_index - b.position_index);
}

export async function getMyOrders(): Promise<MyOrder[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('ticket_orders')
    .select(ORDER_SELECT)
    .eq('buyer_user_id', user.id)
    // a settled order (free or paid) is 'paid'; 'confirmed'/'free' are not valid
    // statuses (the CHECK is pending/paid/canceled/refunded), so filtering on
    // them silently dropped real tickets. This screen shows no refund state, so
    // refunded orders are excluded rather than rendered as if valid.
    .eq('status', 'paid')
    .order('created_at', { ascending: false });
  if (error) return [];
  // supabase-js cannot infer the multi-embed row shape, so it widens to its
  // error type; the query is valid, so read the rows as untyped records
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((o) => {
    const ev = o.explore_events as { title?: string; event_date?: string } | null;
    return {
      id: o.id as string,
      event_id: o.event_id as string,
      qty: o.qty as number,
      total_cents: o.total_cents as number,
      status: o.status as string,
      created_at: o.created_at as string,
      event_title: ev?.title ?? null,
      event_date: ev?.event_date ?? null,
      seats: mapSeats(o),
    };
  });
}

export async function getOrder(orderId: string): Promise<MyOrder | null> {
  const { data, error } = await supabase
    .from('ticket_orders')
    .select(ORDER_SELECT)
    .eq('id', orderId)
    .maybeSingle();
  if (error || !data) return null;
  // same multi-embed widening as getMyOrders: read the row as an untyped record
  const row = data as unknown as Record<string, unknown>;
  const ev = row.explore_events as { title?: string; event_date?: string } | null;
  return {
    id: row.id as string, event_id: row.event_id as string,
    qty: row.qty as number, total_cents: row.total_cents as number,
    status: row.status as string, created_at: row.created_at as string,
    event_title: ev?.title ?? null, event_date: ev?.event_date ?? null,
    seats: mapSeats(row),
  };
}

// ─── doc 111: the organizer's "after they buy" message ───────────────────

/**
 * The organizer's post-purchase note for an event (doc 111; column lands
 * with SQL-96). Self-flipping: while the column does not exist the read
 * errors and this returns null, so the order-complete screen and the
 * wallet render nothing. Reads under the existing Live-events RLS;
 * identifiers are SQL-96 canon (Cowork ruling 8-1), the writer-side twin
 * lives in lib/creatorEvents (CONFIRMATION_MESSAGE_COLUMN).
 */
export async function getConfirmationMessage(eventId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('explore_events')
    .select('confirmation_message')
    .eq('id', eventId)
    .maybeSingle();
  if (error || !data) return null;
  const raw = (data as Record<string, unknown>).confirmation_message;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

// ─── refunds (doc 108 contract; ticket-refund v5, LIVE) ──────────────────
//     the web lib is the lockstep reference (f370d4b/67d5ee2): same
//     shapes, same copy

/** §5 disclosure, LIZ COPY RULED verbatim 7-28, both platforms. Renders
    beside every buyer self-refund affordance; never reworded here. */
export const REFUND_DISCLOSURE =
  "the ticket price comes back. card processing already went to the card company, so that part can't.";

export interface RefundPreview {
  allowed: boolean;
  canSelfRefund: boolean;
  refundAmountCents: number;
  positionCount: number;
}

export type RefundOutcome =
  /** refunded; recording may still be settling when pending is true (the
      contract's stripe-succeeded-recording-failed shape: money moved, the
      drain + backstop reconcile, so the user sees success, not an error) */
  | { ok: true; refundAmountCents: number; positionsVoided: number; pending: boolean }
  | { ok: false; message: string };

/** Raw server text never reaches a user (the humanCheckoutError rule). */
function humanRefundError(raw: string | null | undefined): string {
  const s = (raw ?? '').toLowerCase();
  /* copy to the taste gate: web's shipped strings, mirrored verbatim */
  if (/(sign|auth|jwt|not signed)/.test(s)) return 'sign in to manage this order.';
  if (/(window|closed|too late|past|started|cutoff)/.test(s)) return 'this order can no longer be refunded here. reply to your receipt and a person will help.';
  if (/(already|refunded|voided|nothing left|no remaining)/.test(s)) return 'this order is already refunded.';
  if (/(not allowed|forbidden|not permitted|only the)/.test(s)) return "this order can't be refunded from this account.";
  return 'the refund could not go through. give it a moment and try again.';
}

export type RefundTarget = {
  /** organizer callers only; buyers omit (the server forces buyer_request) */
  kind?: 'buyer_request';
  /** 1-based seat subset (organizer); null/omitted = all remaining seats */
  positionIndexes?: number[] | null;
};

async function invokeRefund(
  orderId: string,
  action: 'preview' | 'refund',
  target: RefundTarget,
): Promise<{ data: Record<string, unknown> | null; raw: string | null }> {
  const body: Record<string, unknown> = { order_id: orderId, action };
  if (target.kind) body.kind = target.kind;
  if (target.positionIndexes !== undefined) body.position_indexes = target.positionIndexes;
  const { data, error } = await supabase.functions.invoke('ticket-refund', { body });
  if (error) {
    // native functions.invoke carries the JSON body on error.context.body
    // (string), not a Response like web; same {error} shape underneath
    let raw: string | null = null;
    try {
      const ctx = (error as { context?: { body?: unknown } }).context;
      const parsed = typeof ctx?.body === 'string' ? JSON.parse(ctx.body) : ctx?.body;
      if (parsed && typeof (parsed as { error?: string }).error === 'string') {
        raw = (parsed as { error: string }).error;
      }
    } catch { /* raw stays null */ }
    return { data: null, raw: raw ?? error.message ?? null };
  }
  return { data: (data ?? null) as Record<string, unknown> | null, raw: null };
}

/** action:"preview": no Stripe call, nothing recorded; the wallet and the
    attendee views render their refund affordances from this answer only. */
export async function previewRefund(
  orderId: string,
  target: RefundTarget = {},
): Promise<RefundPreview | null> {
  const { data } = await invokeRefund(orderId, 'preview', target);
  if (!data || data.ok !== true) return null;
  return {
    allowed: data.allowed === true,
    canSelfRefund: data.can_self_refund === true,
    refundAmountCents: typeof data.refund_amount_cents === 'number' ? data.refund_amount_cents : 0,
    positionCount: typeof data.position_count === 'number' ? data.position_count : 0,
  };
}

/** The refund itself. Contract shapes handled here so callers see one of two
    outcomes: done (possibly still settling) or a human message. A 200 with
    warnings[] IS success (post-refund leg reconciliation is server-side). */
export async function executeRefund(
  orderId: string,
  target: RefundTarget = {},
): Promise<RefundOutcome> {
  const { data, raw } = await invokeRefund(orderId, 'refund', target);
  if (data && data.ok === true) {
    return {
      ok: true,
      refundAmountCents: typeof data.refund_amount_cents === 'number' ? data.refund_amount_cents : 0,
      positionsVoided: typeof data.positions_voided === 'number' ? data.positions_voided : 0,
      pending: false,
    };
  }
  // stripe-succeeded-recording-failed: money moved; recording is idempotent
  // and the drain + backstop reconcile. success.
  if (raw && /succeeded at stripe/i.test(raw)) {
    return { ok: true, refundAmountCents: 0, positionsVoided: 0, pending: true };
  }
  return { ok: false, message: humanRefundError(raw) };
}

/**
 * The canonical buyer-answer value shapes (set by Cowork 2026-07-26). Web's
 * organizer reader + CSV export read the SAME rows, so these must not drift:
 *   short_text / paragraph    -> { text }
 *   single_select / dropdown  -> { choice }
 *   multi_select              -> { choices: [] }
 *   terms                     -> { accepted: true, accepted_at: iso8601 }
 * No bare strings, no other shapes.
 */
export type AnswerValue =
  | { text: string }
  | { choice: string }
  | { choices: string[] }
  | { accepted: boolean; accepted_at: string };

/**
 * Records one buyer answer (C2, own-order RLS). Answers are PER SEAT:
 * attendee_index is NULL for a per_order question and the seat's position_index
 * (1..qty) for a per_attendee one. tg_ticket_answers_validate enforces exactly
 * that, so the old default of 0 made EVERY per_order answer fail silently
 * ('a per-order question takes no attendee_index'). The caller owns the index;
 * there is no default. Returns {ok, message} so the flow surfaces a failure
 * instead of swallowing it.
 */
export async function recordAnswer(
  orderId: string,
  questionId: string,
  value: AnswerValue,
  attendeeIndex: number | null,
): Promise<{ ok: boolean; message: string | null }> {
  const { error } = await supabase.from('ticket_answers').insert({
    order_id: orderId,
    question_id: questionId,
    attendee_index: attendeeIndex,
    value,
  });
  return { ok: !error, message: error?.message ?? null };
}
