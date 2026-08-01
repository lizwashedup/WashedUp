/**
 * Docs 113 + 114 client half: promo codes + add-ons, built in parallel with
 * the schema (the doc-111 pattern, executed again). EVERYTHING here is
 * dormant until the tables land on prod: creator sections and buyer
 * surfaces render only when a probe succeeds, so nothing exists for anyone
 * until the schema does, and a wrong binding is inert, never a data trap.
 *
 * Money law: a buyer-facing price changed by a promo comes ONLY from the
 * server's answer (quotePromoCode). The client never computes a discount.
 */

import { supabase } from './supabase';

// ─── BINDINGS (docs 113/114, schema authored in parallel) ─────────────────
// SEAT BINDING REQUIRED at review: every identifier the wire sees lives
// here. Rebind to the applied proposals' canon if any name differs; the
// probes keep wrong names inert in the meantime.
export const PROMO_TABLE = 'ticket_promotions';
export const ADDON_TABLE = 'ticket_addons';
/** create-ticket-checkout body keys the purchase call carries (doc 113/114
 *  checkout halves); the fn ignores unknown keys, and both buyer surfaces
 *  are probe-gated, so these ride only once the schema exists. */
export const CHECKOUT_PROMO_KEY = 'promo_code';
export const CHECKOUT_ADDONS_KEY = 'addons';
/** PROPOSED server door for repricing (seat binds): the checkout fn
 *  answers a no-charge quote for tier+qty+code+addons. */
export const QUOTE_ACTION_KEY = 'action';
export const QUOTE_ACTION_VALUE = 'quote';

// ─── shapes ────────────────────────────────────────────────────────────────

export interface TicketPromotion {
  id: string;
  event_id: string;
  code: string;
  /** exactly one of the two is set */
  percent_off: number | null;
  amount_off_cents: number | null;
  uses_cap: number | null;
  uses_count: number;
  starts_at: string | null;
  ends_at: string | null;
}

export interface PromotionDraft {
  code: string;
  percent_off: number | null;
  amount_off_cents: number | null;
  uses_cap: number | null;
  starts_at: string | null;
  ends_at: string | null;
}

export interface TicketAddon {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  image_url: string | null;
  quantity_cap: number | null;
  per_order_max: number | null;
  sort_order: number;
}

export interface AddonDraft {
  name: string;
  description: string | null;
  price_cents: number;
  image_url: string | null;
  quantity_cap: number | null;
  per_order_max: number | null;
}

const PROMO_COLUMNS =
  'id, event_id, code, percent_off, amount_off_cents, uses_cap, uses_count, starts_at, ends_at';
const ADDON_COLUMNS =
  'id, event_id, name, description, price_cents, image_url, quantity_cap, per_order_max, sort_order';

// ─── probes (the join-gate doors) ──────────────────────────────────────────

async function tableOpen(table: string): Promise<boolean> {
  const { error } = await supabase.from(table).select('id').limit(1);
  return !error;
}

/** Both doors in one ask, for the creator screen. */
export async function probePromosAddons(): Promise<{ promos: boolean; addons: boolean }> {
  const [promos, addons] = await Promise.all([tableOpen(PROMO_TABLE), tableOpen(ADDON_TABLE)]);
  return { promos, addons };
}

// ─── creator CRUD (direct table ops under RLS, the ticket_tiers pattern) ──

export async function listPromotions(eventId: string): Promise<TicketPromotion[]> {
  const { data, error } = await supabase
    .from(PROMO_TABLE)
    .select(PROMO_COLUMNS)
    .eq('event_id', eventId)
    .order('code', { ascending: true });
  if (error) return [];
  return (data ?? []) as unknown as TicketPromotion[];
}

export async function createPromotion(
  eventId: string,
  draft: PromotionDraft,
): Promise<{ ok: boolean; message: string | null }> {
  const { error } = await supabase.from(PROMO_TABLE).insert({ event_id: eventId, ...draft });
  return { ok: !error, message: error?.message ?? null };
}

export async function deletePromotion(promoId: string): Promise<boolean> {
  const { error } = await supabase.from(PROMO_TABLE).delete().eq('id', promoId);
  return !error;
}

export async function listAddons(eventId: string): Promise<TicketAddon[]> {
  const { data, error } = await supabase
    .from(ADDON_TABLE)
    .select(ADDON_COLUMNS)
    .eq('event_id', eventId)
    .order('sort_order', { ascending: true });
  if (error) return [];
  return (data ?? []) as unknown as TicketAddon[];
}

export async function createAddon(
  eventId: string,
  draft: AddonDraft,
  sortOrder: number,
): Promise<{ ok: boolean; message: string | null }> {
  const { error } = await supabase
    .from(ADDON_TABLE)
    .insert({ event_id: eventId, ...draft, sort_order: sortOrder });
  return { ok: !error, message: error?.message ?? null };
}

export async function updateAddon(
  addonId: string,
  patch: Partial<AddonDraft>,
): Promise<{ ok: boolean; message: string | null }> {
  const { error } = await supabase.from(ADDON_TABLE).update(patch).eq('id', addonId);
  return { ok: !error, message: error?.message ?? null };
}

export async function deleteAddon(addonId: string): Promise<boolean> {
  const { error } = await supabase.from(ADDON_TABLE).delete().eq('id', addonId);
  return !error;
}

// ─── buyer reads ───────────────────────────────────────────────────────────

/** The event's buyable add-ons; [] while the table (or RLS read) is absent,
 *  which keeps the buyer step invisible until doc 114 lands. */
export async function listBuyerAddons(eventId: string): Promise<TicketAddon[]> {
  return listAddons(eventId);
}

/** One add-on selection on an order. */
export interface AddonSelection {
  addon_id: string;
  qty: number;
}

// ─── the server's repricing answer (money is never client math) ───────────

export interface PromoQuote {
  totalCents: number;
  code: string;
}

/**
 * PROPOSED CONTRACT (doc 113's checkout half; seat binds): ask the checkout
 * fn for a no-charge quote of tier+qty+code(+add-ons). Only a recognizable
 * affirmative answer reprices anything; every other shape (fn without quote
 * support, bad code, expired window, network) returns null and the sheet
 * keeps the undiscounted price. A promo can therefore never show a price
 * the server did not say.
 */
export async function quotePromoCode(
  tierId: string,
  qty: number,
  code: string,
  addons: AddonSelection[],
): Promise<PromoQuote | null> {
  const body: Record<string, unknown> = {
    [QUOTE_ACTION_KEY]: QUOTE_ACTION_VALUE,
    tier_id: tierId,
    qty,
    [CHECKOUT_PROMO_KEY]: code.trim(),
  };
  if (addons.length > 0) body[CHECKOUT_ADDONS_KEY] = addons;
  const { data, error } = await supabase.functions.invoke('create-ticket-checkout', { body });
  if (error || !data || data.ok !== true || typeof data.total_cents !== 'number') return null;
  return { totalCents: data.total_cents, code: code.trim() };
}
