/**
 * Docs 113 + 114 client half: promo codes + add-ons. BOUND TO CANON
 * (seat-verified on prod, 2026-08-01).
 *
 * Promos ride the EXISTING ticket_promo_codes table, so this half has no
 * dormancy: it is live the moment the client ships. Add-ons ride
 * event_add_ons (buyer-readable for on_sale rows on Live events);
 * order_add_ons is service_role-written and clients NEVER insert order
 * lines, they only hand picks to checkout.
 *
 * Money law: a buyer-facing price comes ONLY from the server
 * (quote_ticket_checkout). The client never computes a discount.
 */

import { supabase } from './supabase';

// ─── BINDINGS (canon, seat-verified 2026-08-01) ───────────────────────────
export const PROMO_TABLE = 'ticket_promo_codes';
export const ADDON_TABLE = 'event_add_ons';
/** the pricing door: authenticated + service_role, NOT anon */
export const QUOTE_RPC = 'quote_ticket_checkout';
/** create-ticket-checkout body keys */
export const CHECKOUT_PROMO_KEY = 'promo_code';
export const CHECKOUT_ADDONS_KEY = 'add_ons';

/** house convention (ruling 1): percent is 1-100, flat is CENTS. */
export type DiscountType = 'percent' | 'flat';
export type AddonStatus = 'draft' | 'on_sale';

// ─── shapes ────────────────────────────────────────────────────────────────

export interface PromoCode {
  id: string;
  event_id: string;
  code: string;
  discount_type: DiscountType;
  discount_value: number;
  unlocks_hidden: boolean;
  max_uses: number | null;
  uses_count: number;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
}

export interface PromoDraft {
  code: string;
  discount_type: DiscountType;
  discount_value: number;
  unlocks_hidden: boolean;
  max_uses: number | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
}

export interface EventAddon {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price_cents: number;
  quantity_cap: number | null;
  per_order_max: number | null;
  sales_open_at: string | null;
  sales_close_at: string | null;
  sold_count: number;
  status: AddonStatus;
}

export interface AddonDraft {
  name: string;
  description: string | null;
  image_url: string | null;
  price_cents: number;
  quantity_cap: number | null;
  per_order_max: number | null;
  status: AddonStatus;
}

/** TK-02: a size/flavor/option sub-pick. Label only, never its own price --
 *  see the migration header for why (no quote/charge mismatch to reason
 *  about when a variation cannot change the total). */
export interface AddonVariation {
  id: string;
  label: string;
}

const PROMO_COLUMNS =
  'id, event_id, code, discount_type, discount_value, unlocks_hidden, max_uses, uses_count, starts_at, ends_at, active';
const ADDON_COLUMNS =
  'id, event_id, name, description, image_url, price_cents, quantity_cap, per_order_max, sales_open_at, sales_close_at, sold_count, status';

/** column 42703 = the TK-02 migration has not been applied yet. Isolated
 *  from ADDON_COLUMNS on purpose: the buyer's core add-on list must never
 *  break because a variations column does not exist yet on prod. Same
 *  dormant-until-applied shape as isMissingSchema in ticketing.ts,
 *  topicAlbum.ts, organizerFollows.ts (each keeps its own copy, house
 *  convention, not shared). */
function isMissingVariationsColumn(code: string | undefined): boolean {
  return code === '42703' || code === 'PGRST204';
}

/** One add-on pick on an order. The key is canon (add_on_id, not addon_id). */
export interface AddonSelection {
  add_on_id: string;
  qty: number;
  /** TK-02: which variation was picked, when the add-on has any. Omitted
   *  entirely for an add-on with no variations, so the checkout body is
   *  byte-identical to before this field existed until it is actually used. */
  variation_id?: string;
}

// ─── creator: promo codes (organizer ALL-access + ownership WITH CHECK) ───

export async function listPromoCodes(eventId: string): Promise<PromoCode[]> {
  const { data, error } = await supabase
    .from(PROMO_TABLE)
    .select(PROMO_COLUMNS)
    .eq('event_id', eventId)
    .order('code', { ascending: true });
  if (error) return [];
  return (data ?? []) as unknown as PromoCode[];
}

/** The unique index is case-insensitive on (event_id, lower(code)), so a
 *  duplicate comes back as a constraint error and is surfaced, not hidden. */
export async function createPromoCode(
  eventId: string,
  draft: PromoDraft,
): Promise<{ ok: boolean; message: string | null }> {
  const { error } = await supabase.from(PROMO_TABLE).insert({ event_id: eventId, ...draft });
  return { ok: !error, message: error?.message ?? null };
}

export async function setPromoActive(
  promoId: string,
  active: boolean,
): Promise<{ ok: boolean; message: string | null }> {
  const { error } = await supabase.from(PROMO_TABLE).update({ active }).eq('id', promoId);
  return { ok: !error, message: error?.message ?? null };
}

export async function deletePromoCode(promoId: string): Promise<boolean> {
  const { error } = await supabase.from(PROMO_TABLE).delete().eq('id', promoId);
  return !error;
}

// ─── creator: add-ons ──────────────────────────────────────────────────────

export async function listAddons(eventId: string): Promise<EventAddon[]> {
  const { data, error } = await supabase
    .from(ADDON_TABLE)
    .select(ADDON_COLUMNS)
    .eq('event_id', eventId)
    .order('name', { ascending: true });
  if (error) return [];
  return (data ?? []) as unknown as EventAddon[];
}

export async function createAddon(
  eventId: string,
  draft: AddonDraft,
): Promise<{ ok: boolean; message: string | null }> {
  const { error } = await supabase.from(ADDON_TABLE).insert({ event_id: eventId, ...draft });
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

/**
 * TK-02, creator side: the variations configured on one add-on, own isolated
 * read so a pre-migration prod never breaks the editor around it. []  on any
 * failure (missing column, RLS, network) -- the editor then just shows no
 * variations yet, same as a real empty list.
 */
export async function getAddonVariations(addonId: string): Promise<AddonVariation[]> {
  const { data, error } = await supabase
    .from(ADDON_TABLE)
    .select('variations')
    .eq('id', addonId)
    .maybeSingle();
  if (error || !data) return [];
  const raw = (data as { variations?: unknown }).variations;
  return Array.isArray(raw) ? (raw as AddonVariation[]) : [];
}

/**
 * TK-02, creator side: replace the whole variations list on one add-on.
 * Isolated write, same dormancy as every other unapplied-migration write in
 * this file family (setJoinPolicy, withdrawOperatorApplication): fails
 * cleanly with a friendly message until the migration lands, touches
 * nothing else on the row.
 */
export async function setAddonVariations(
  addonId: string,
  variations: AddonVariation[],
): Promise<{ ok: boolean; message: string | null }> {
  const { error } = await supabase.from(ADDON_TABLE).update({ variations }).eq('id', addonId);
  if (!error) return { ok: true, message: null };
  if (isMissingVariationsColumn(error.code)) {
    return { ok: false, message: "options aren't turned on for this event yet." };
  }
  return { ok: false, message: error.message };
}

/**
 * TK-02, buyer side: variations for a batch of add-ons in one round trip,
 * keyed by add_on_id. Isolated from listBuyerAddons/ADDON_COLUMNS on
 * purpose -- see isMissingVariationsColumn above. Empty map on any failure,
 * which reads to the buyer exactly like "no options," never an error.
 */
export async function getAddonVariationsMap(
  addonIds: string[],
): Promise<Map<string, AddonVariation[]>> {
  const map = new Map<string, AddonVariation[]>();
  if (addonIds.length === 0) return map;
  const { data, error } = await supabase
    .from(ADDON_TABLE)
    .select('id, variations')
    .in('id', addonIds);
  if (error || !data) return map;
  for (const row of data as { id: string; variations?: unknown }[]) {
    const raw = row.variations;
    if (Array.isArray(raw) && raw.length > 0) map.set(row.id, raw as AddonVariation[]);
  }
  return map;
}

// ─── buyer: what is actually buyable right now ────────────────────────────

/** Remaining stock, or null when the add-on is uncapped. */
export function addonRemaining(a: EventAddon): number | null {
  return a.quantity_cap == null ? null : Math.max(0, a.quantity_cap - (a.sold_count ?? 0));
}

/**
 * The buyer's list: on_sale only, inside its sales window, not sold out.
 * RLS already scopes the read to on_sale rows on Live events (ruling 3);
 * this is the client half of the same law, so a draft or spent add-on can
 * never be picked. Window bounds are instants, so a plain now-comparison is
 * timezone-safe.
 */
export async function listBuyerAddons(eventId: string): Promise<EventAddon[]> {
  const all = await listAddons(eventId);
  const now = Date.now();
  return all.filter((a) => {
    if (a.status !== 'on_sale') return false;
    if (a.sales_open_at && new Date(a.sales_open_at).getTime() > now) return false;
    if (a.sales_close_at && new Date(a.sales_close_at).getTime() <= now) return false;
    const left = addonRemaining(a);
    return left === null || left > 0;
  });
}

// ─── the server's price (money is never client math) ──────────────────────

export interface PriceQuote {
  ok: boolean;
  faceCents: number;
  discountCents: number;
  processingCents: number;
  addonTotalCents: number;
  totalCents: number;
  isFree: boolean;
  promoValid: boolean;
  promoReason: string | null;
  reason: string | null;
}

/**
 * quote_ticket_checkout: the one place a shown price can come from. The RPC
 * is authenticated-only, so a signed-out buyer gets null here; the sheet
 * then shows the undiscounted price and lets checkout do the real pricing
 * (the ruled fallback). Returns null on ANY unreadable answer, so a missing
 * or changed door can never fabricate a number.
 */
export async function quoteCheckout(
  tierId: string,
  qty: number,
  promoCode: string | null,
  addons: AddonSelection[],
): Promise<PriceQuote | null> {
  const { data, error } = await supabase.rpc(QUOTE_RPC, {
    p_tier_id: tierId,
    p_qty: qty,
    p_promo_code: promoCode?.trim() ? promoCode.trim() : null,
    p_add_ons: addons.length > 0 ? addons : null,
  });
  if (error || !data) return null;
  // RETURNS TABLE hands back an array; a scalar record hands back an object
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row || typeof row.total_cents !== 'number') return null;
  return {
    ok: row.ok === true,
    faceCents: typeof row.face_cents === 'number' ? row.face_cents : 0,
    discountCents: typeof row.discount_cents === 'number' ? row.discount_cents : 0,
    processingCents: typeof row.processing_cents === 'number' ? row.processing_cents : 0,
    addonTotalCents: typeof row.addon_total_cents === 'number' ? row.addon_total_cents : 0,
    totalCents: row.total_cents,
    isFree: row.is_free === true,
    promoValid: row.promo_valid === true,
    promoReason: typeof row.promo_reason === 'string' ? row.promo_reason : null,
    reason: typeof row.reason === 'string' ? row.reason : null,
  };
}
