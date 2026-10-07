import { supabase } from './supabase';
import type { CheckoutOwner } from './ticketCheckoutAttempt';

export interface PurchasedExtra {
  id: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  optionLabel: string | null;
}
const columns = 'id,event_id,order_add_ons(id,qty,unit_price_cents,name_snapshot,variation_id,variation_label_snapshot)';
const requireCurrent = (owner: CheckoutOwner) => {
  if (!owner.isCurrent()) throw new Error('This purchase visit is no longer active.');
};

/** Read original purchase snapshots, never the creator’s current extra configuration. */
export async function readPurchaseExtras(eventId: string, orderIds: string[], owner: CheckoutOwner, buyerOnly = true): Promise<Map<string, PurchasedExtra[]>> {
  requireCurrent(owner);
  const ids = [...new Set(orderIds)];
  if (!eventId || ids.some(id => !id)) throw new Error('Purchase context is missing.');
  const output = new Map<string, PurchasedExtra[]>();
  if (!ids.length) return output;
  const session = await supabase.auth.getSession();
  requireCurrent(owner);
  if (session.error || session.data.session?.user.id !== owner.userId || !session.data.session.access_token) {
    throw new Error('Check your sign-in to read these extras.');
  }
  const authorization = `Bearer ${session.data.session.access_token}`;
  // Bound each response; an order has at most 20 extras. Preserve all requested orders.
  for (let offset = 0; offset < ids.length; offset += 40) {
    const batch = ids.slice(offset, offset + 40);
    requireCurrent(owner);
    let request = supabase.from('ticket_orders').select(columns).eq('event_id', eventId).in('id', batch);
    if (buyerOnly) request = request.eq('buyer_user_id', owner.userId);
    const { data, error } = await request.setHeader('Authorization', authorization);
    requireCurrent(owner);
    if (error || !Array.isArray(data) || data.length !== batch.length) throw new Error('The purchase extras could not be loaded.');
    for (const row of data as unknown as Record<string, unknown>[]) {
      if (row.event_id !== eventId || typeof row.id !== 'string' || !batch.includes(row.id) || output.has(row.id) || !Array.isArray(row.order_add_ons)) {
        throw new Error('The purchase extras could not be loaded.');
      }
      const extras: PurchasedExtra[] = row.order_add_ons.map((raw: Record<string, unknown>) => {
        if (!raw || typeof raw.id !== 'string' || typeof raw.name_snapshot !== 'string' || !raw.name_snapshot.trim() ||
            !Number.isInteger(raw.qty) || Number(raw.qty) < 1 || !Number.isInteger(raw.unit_price_cents) || Number(raw.unit_price_cents) < 0 ||
            (raw.variation_id != null && (typeof raw.variation_label_snapshot !== 'string' || !raw.variation_label_snapshot.trim()))) {
          throw new Error('The purchase extras could not be loaded.');
        }
        return { id: raw.id, name: raw.name_snapshot, quantity: Number(raw.qty), unitPriceCents: Number(raw.unit_price_cents),
          optionLabel: typeof raw.variation_label_snapshot === 'string' ? raw.variation_label_snapshot : null };
      });
      output.set(row.id, extras);
    }
  }
  return output;
}
