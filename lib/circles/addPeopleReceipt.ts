import type { QueryClient } from '@tanstack/react-query';
import { requestWithDeadline } from '../requestWithDeadline';
import { supabase } from '../supabase';

type Decision = { ids: string[]; writing: boolean };
const pending = new WeakMap<QueryClient, Map<string, Decision>>();
const keyFor = (viewer: string, circle: string) => JSON.stringify([viewer, circle]);

export class UnknownCircleAdd extends Error {
  constructor() { super('Check who is in the circle before trying again.'); }
}

export class IncompleteCircleAdd extends Error {
  constructor(readonly missing: string[], readonly joined: string[]) {
    super(joined.length ? 'Some people are already in the circle. Only the remaining people are selected.' :
      'They haven’t joined this circle. You can try adding them again.');
  }
}

export function pendingCircleAdd(client: QueryClient, viewer: string, circle: string) {
  return pending.get(client)?.get(keyFor(viewer, circle))?.ids;
}

/** Both supported RPC definitions return a changed-row count. Already joined
 * recipients are successful no-ops. Only a lost/malformed receipt needs a read. */
export async function addPeopleWithReceipt(client: QueryClient, viewer: string, circle: string,
  selected: string[], requireCurrent: () => void, checkOnly: boolean): Promise<number> {
  requireCurrent();
  let store = pending.get(client);
  if (!store) { store = new Map(); pending.set(client, store); }
  const key = keyFor(viewer, circle);
  let decision = store.get(key);
  if (decision?.writing || (decision && !checkOnly) || (!decision && checkOnly)) {
    throw new UnknownCircleAdd();
  }
  if (!decision) {
    decision = {ids: [...new Set(selected)], writing: true};
    store.set(key, decision);
    let receipt;
    try {
      receipt = await supabase.rpc('invite_to_circle', {p_circle_id: circle, p_user_ids: decision.ids});
    } catch { /* Read back the intended memberships after a transport failure. */ }
    finally { decision.writing = false; }
    requireCurrent();
    if (receipt && !receipt.error && Number.isInteger(receipt.data) && receipt.data >= 0 && receipt.data <= decision.ids.length) {
      store.delete(key);
      return receipt.data;
    }
    if (receipt?.error && ['42501','P0001','23503','23514','22P02','42883'].includes(receipt.error.code)) {
      store.delete(key);
      throw receipt.error;
    }
  }
  let result;
  try {
    result = await requestWithDeadline(supabase.rpc('get_circle', {p_circle_id: circle}), 8000);
  } catch { /* A missing read leaves the decision available after reopening. */ }
  requireCurrent();
  const rows = result?.data?.members;
  if (store.get(key) !== decision || result?.error || result?.data?.circle?.id !== circle ||
    !Array.isArray(rows) || !rows.every(r => typeof r?.user_id === 'string') ||
    !rows.some(r => r.user_id === viewer)) throw new UnknownCircleAdd();
  const members = new Set(rows.map(row => row.user_id));
  const missing = decision.ids.filter(id => !members.has(id));
  store.delete(key);
  if (missing.length) throw new IncompleteCircleAdd(missing, decision.ids.filter(id => members.has(id)));
  return 0; // Membership confirmed. We cannot attribute those joins to this write.
}
