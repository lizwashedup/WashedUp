/**
 * Destinations that have to survive a detour.
 *
 * Two audit findings share one shape: the app sends someone away (to the
 * login gate, or out to Stripe's hosted checkout in a browser) and then
 * loses where they were going.
 *
 *  - finding 5: a signed-out stranger taps a shared link, gets bounced to
 *    phone-entry, signs up, and lands on Plans. The thing they tapped is
 *    gone and there is no way back to it.
 *  - finding 2: a buyer pays on Stripe and never returns into the app, so
 *    order-complete and the organizer's questions never run.
 *
 * Both are fixed by writing the destination down before the detour and
 * consuming it once, on the other side. Storage is AsyncStorage so it also
 * survives the app being killed mid-detour. Everything here is best-effort:
 * a failed read never blocks a screen.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const DESTINATION_KEY = 'pendingLinkDestination';
const CHECKOUT_KEY = 'pendingCheckoutOrderId';

/**
 * A washedup.app (or washedupapp://) URL to the in-app route it means, or
 * null when it is not a link we route. Deliberately narrow: only the shapes
 * the app actually claims. `/e/<id>` stays as `/e/<id>` so the resolver
 * route decides event-vs-plan by asking the database.
 */
export function parseAppDestination(url: string): string | null {
  if (!url) return null;
  if (!/washedup/i.test(url)) return null;
  // strip scheme/host/query so one matcher handles https and the custom scheme
  const path = url
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^[^/]*/, '')
    .split('?')[0]
    .split('#')[0];

  const e = path.match(/^\/e\/([A-Za-z0-9-]+)$/);
  if (e) return `/e/${e[1]}`;
  const plan = path.match(/^\/plans\/([A-Za-z0-9_-]+)$/);
  if (plan) return `/plans/${plan[1]}`;
  const appPlan = path.match(/^\/app\/plan\/([A-Za-z0-9-]+)$/);
  if (appPlan) return `/plan/${appPlan[1]}`;
  const appEvent = path.match(/^\/app\/event\/([A-Za-z0-9-]+)$/);
  if (appEvent) return `/event/${appEvent[1]}`;
  return null;
}

export async function stashPendingDestination(href: string): Promise<void> {
  try { await AsyncStorage.setItem(DESTINATION_KEY, href); } catch { /* best-effort */ }
}

/** Reads and clears in one go, so a destination can never be replayed. */
export async function consumePendingDestination(): Promise<string | null> {
  try {
    const href = await AsyncStorage.getItem(DESTINATION_KEY);
    if (href) await AsyncStorage.removeItem(DESTINATION_KEY);
    return href;
  } catch {
    return null;
  }
}

export async function clearPendingDestination(): Promise<void> {
  try { await AsyncStorage.removeItem(DESTINATION_KEY); } catch { /* best-effort */ }
}

/** Written the moment we hand a buyer to Stripe, with the order already minted. */
export async function stashPendingCheckout(orderId: string): Promise<void> {
  try { await AsyncStorage.setItem(CHECKOUT_KEY, orderId); } catch { /* best-effort */ }
}

export async function consumePendingCheckout(): Promise<string | null> {
  try {
    const orderId = await AsyncStorage.getItem(CHECKOUT_KEY);
    if (orderId) await AsyncStorage.removeItem(CHECKOUT_KEY);
    return orderId;
  } catch {
    return null;
  }
}
