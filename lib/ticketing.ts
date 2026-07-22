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
