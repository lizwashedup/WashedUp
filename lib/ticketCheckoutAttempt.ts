import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import type { CheckoutAnswer } from './ticketing';
import type { AddonSelection } from './ticketPromosAddons';

export interface CheckoutOwner { userId: string | null; isCurrent(): boolean; }
export interface CheckoutSelection {
  eventId: string; tierId: string; qty: number; promoCode: string | null;
  addons: AddonSelection[]; answers: CheckoutAnswer[];
}
export interface CheckoutAttempt {
  version: 1; key: string; userId: string; eventId: string; tierId: string; qty: number;
  promoCode: string | null; addons: AddonSelection[];
  fingerprint: string; hasAnswers: boolean;
}
export interface CheckoutAttemptOrder { id: string; event_id: string; status: 'pending' | 'paid' | 'canceled' | 'refunded'; tier_id: string; qty: number; }
const locks = new Map<string, Promise<unknown>>();
const current = (owner: CheckoutOwner) => { if (!owner.userId || !owner.isCurrent()) throw new Error('This checkout account is no longer active.'); };
const storageKey = (eventId: string, owner: CheckoutOwner) => `ticket-checkout-attempt:v1:${owner.userId}:${eventId}`;
async function serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (locks.get(key) ?? Promise.resolve()).then(action, action);
  locks.set(key, result);
  try { return await result; } finally { if (locks.get(key) === result) locks.delete(key); }
}
function validAddon(value: any): boolean { return !!value && typeof value.add_on_id === 'string' && !!value.add_on_id && Number.isSafeInteger(value.qty) && value.qty > 0 && (value.variation_id === undefined || (typeof value.variation_id === 'string' && value.variation_id.trim().length > 0 && value.variation_id.length <= 128)); }
export async function readCheckoutAttempt(eventId: string, owner: CheckoutOwner): Promise<CheckoutAttempt | null> {
  current(owner);
  const raw = await AsyncStorage.getItem(storageKey(eventId, owner));
  current(owner);
  if (!raw) return null;
  const value = JSON.parse(raw) as CheckoutAttempt;
  if (value.version !== 1 || value.userId !== owner.userId || value.eventId !== eventId
    || typeof value.key !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(value.key)
    || typeof value.tierId !== 'string' || !value.tierId || !Number.isSafeInteger(value.qty) || value.qty < 1
    || !(value.promoCode === null || typeof value.promoCode === 'string')
    || !Array.isArray(value.addons) || !value.addons.every(validAddon)
    || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || typeof value.hasAnswers !== 'boolean') throw new Error('The saved checkout could not be read.');
  return value;
}
async function fingerprint(selection: CheckoutSelection): Promise<string> {
  const addons = [...selection.addons].sort((a,b) => a.add_on_id.localeCompare(b.add_on_id));
  const answers = selection.answers.map(answer => ({
    questionId: answer.question_id, attendeeIndex: answer.attendee_index ?? null,
    // Reaffirming identical consent has a fresh timestamp; choice order is not a change.
    value: 'accepted' in answer.value ? {accepted:answer.value.accepted}
      : 'choices' in answer.value ? {choices:[...answer.value.choices].sort()}
      : 'choice' in answer.value ? {choice:answer.value.choice} : {text:answer.value.text},
  })).sort((a,b) => a.questionId.localeCompare(b.questionId) || (a.attendeeIndex ?? -1) - (b.attendeeIndex ?? -1));
  // Only this hash survives; question responses are never put in recovery storage.
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify({
    eventId: selection.eventId, tierId: selection.tierId, qty: selection.qty,
    promoCode: selection.promoCode?.trim() || null, addons, answers,
  }));
}
export class CheckoutSelectionChanged extends Error {
  constructor() { super('Restore the saved ticket selection and answers to continue this checkout.'); }
}
/** Persist before dispatch, serialize same-account/event writers, and never replace an unresolved key. */
export async function prepareCheckoutAttempt(selection: CheckoutSelection, owner: CheckoutOwner): Promise<CheckoutAttempt> {
  current(owner);
  if (!selection.eventId || !selection.tierId || !Number.isSafeInteger(selection.qty) || selection.qty < 1
    || !selection.addons.every(validAddon)) throw new Error('Choose your tickets before continuing.');
  const digest = await fingerprint(selection); current(owner);
  return serialized(storageKey(selection.eventId, owner), async () => {
    const existing = await readCheckoutAttempt(selection.eventId, owner);
    if (existing) { if (existing.fingerprint !== digest) throw new CheckoutSelectionChanged(); return existing; }
    const attempt: CheckoutAttempt = { version: 1, key: Crypto.randomUUID(), userId: owner.userId!, eventId: selection.eventId,
      tierId: selection.tierId, qty: selection.qty, promoCode: selection.promoCode?.trim() || null,
      addons: selection.addons.map(value => ({...value})), fingerprint: digest, hasAnswers: selection.answers.length > 0 };
    await AsyncStorage.setItem(storageKey(selection.eventId, owner), JSON.stringify(attempt));
    current(owner); return attempt;
  });
}
/** Read the exact buyer-namespaced key used by the existing checkout Edge function. */
export async function findCheckoutAttemptOrder(attempt: CheckoutAttempt, owner: CheckoutOwner): Promise<CheckoutAttemptOrder | null> {
  current(owner); if (attempt.userId !== owner.userId) throw new Error('This checkout belongs to another account.');
  const {data,error} = await supabase.from('ticket_orders').select('id,event_id,status,tier_id,qty')
    .eq('buyer_user_id', owner.userId).eq('event_id', attempt.eventId)
    .eq('idempotency_key', `ctc:${owner.userId}:${attempt.key}`).maybeSingle();
  current(owner); if (error) throw error; if (!data) return null;
  if (typeof data.id !== 'string' || !data.id || data.event_id !== attempt.eventId || data.tier_id !== attempt.tierId
    || data.qty !== attempt.qty || !['pending','paid','canceled','refunded'].includes(data.status)) throw new Error('The saved order could not be confirmed.');
  return data as CheckoutAttemptOrder;
}
/** Only a readable terminal order resolves an attempt. An empty read never authorizes a new key. */
export async function finishCheckoutAttempt(attempt: CheckoutAttempt, order: CheckoutAttemptOrder, owner: CheckoutOwner): Promise<void> {
  current(owner);
  if (attempt.userId !== owner.userId) throw new Error('This checkout belongs to another account.');
  if (order.status === 'pending' || order.event_id !== attempt.eventId || order.tier_id !== attempt.tierId || order.qty !== attempt.qty) throw new Error('This checkout is still pending.');
  await serialized(storageKey(attempt.eventId, owner), async () => {
    const existing = await readCheckoutAttempt(attempt.eventId, owner);
    if (existing?.key === attempt.key) await AsyncStorage.removeItem(storageKey(attempt.eventId, owner));
    current(owner);
  });
}

export type CheckoutStopResult = {state:'stopped';orderId:null} | {state:'pending'|'paid'|'canceled'|'refunded';orderId:string};
/** Explicit buyer intent. Only a server barrier acknowledgement allows a new key. */
export async function stopCheckoutAttempt(attempt: CheckoutAttempt, owner: CheckoutOwner): Promise<CheckoutStopResult> {
  current(owner);
  if (attempt.userId !== owner.userId) throw new Error('This checkout belongs to another account.');
  return serialized(storageKey(attempt.eventId, owner), async () => {
    const existing = await readCheckoutAttempt(attempt.eventId, owner);
    if (!existing || existing.key !== attempt.key) throw new Error('The saved checkout changed. Check its status again.');
    const {data,error} = await supabase.rpc('stop_ticket_checkout_attempt', {
      p_event_id:attempt.eventId, p_checkout_key:attempt.key, p_buyer_user_id:owner.userId,
    });
    current(owner);
    if (error) throw error;
    const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (row?.state === 'stopped' && row.order_id === null) {
      // If local removal fails, keep recovery visible and repeat the idempotent stop.
      await AsyncStorage.removeItem(storageKey(attempt.eventId, owner));
      current(owner);
      return {state:'stopped',orderId:null};
    }
    if (row && ['pending','paid','canceled','refunded'].includes(row.state) && typeof row.order_id === 'string' && row.order_id) {
      return {state:row.state,orderId:row.order_id};
    }
    throw new Error('The checkout change could not be confirmed.');
  });
}
