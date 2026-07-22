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
}

export async function getMyPayoutState(userId: string): Promise<PayoutState> {
  const { data, error } = await supabase
    .from('organizer_stripe_accounts')
    .select('charges_enabled, payouts_enabled, details_submitted, commission_bps')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) {
    return {
      exists: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      commissionBps: FALLBACK_COMMISSION_BPS,
    };
  }
  return {
    exists: true,
    chargesEnabled: !!data.charges_enabled,
    payoutsEnabled: !!data.payouts_enabled,
    detailsSubmitted: !!data.details_submitted,
    commissionBps: data.commission_bps ?? FALLBACK_COMMISSION_BPS,
  };
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
 * Law 11 also wants ONE tier marked "most popular". ticket_tiers carries
 * no recommended/badge column on prod, so rather than invent an
 * unvalidated key the lowest-sorted ON-SALE tier is treated as the
 * recommended one by convention. If the product wants an explicit,
 * organizer-chosen badge, that is a column and a numbered proposal.
 */
export function recommendedTierId(tiers: TicketTier[]): string | null {
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

export async function retireQuestion(questionId: string): Promise<boolean> {
  const { error } = await supabase
    .from('ticket_questions')
    .update({ is_active: false })
    .eq('id', questionId);
  return !error;
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
