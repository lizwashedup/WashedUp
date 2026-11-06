import type { QueryClient } from '@tanstack/react-query';
import { requestWithDeadline } from '../requestWithDeadline';
import { supabase } from '../supabase';

type Receipt = 'left' | 'not_member';
type Check = { pending: boolean };
// Detail and Chats can mount separate controllers for the same membership.
// Keep unresolved decisions across those routes, scoped to this app session.
const checks = new WeakMap<QueryClient, Map<string, Check>>();

export class CircleLeaveUnconfirmed extends Error {
  constructor() {
    super('Couldn’t confirm the change. Check your status before trying again.');
    this.name = 'CircleLeaveUnconfirmed';
  }
}

export async function leaveCircleWithReceipt(client: QueryClient, userId: string, circleId: string,
  requireCurrent: () => void, checkOnly = false): Promise<Receipt> {
  const key = JSON.stringify([userId, circleId]);
  let store = checks.get(client);
  if (!store) { store = new Map(); checks.set(client, store); }
  const previous = store.get(key);
  const check = previous ?? { pending: !checkOnly };
  const clear = () => { if (store.get(key) === check) store.delete(key); };
  requireCurrent();
  if (previous?.pending) throw new CircleLeaveUnconfirmed();
  if (!previous) store.set(key, check);
  if (!previous && !checkOnly) {
    let response;
    try { response = await supabase.rpc('leave_circle', { p_circle_id: circleId }); }
    catch { /* A transport failure does not establish whether it committed. */ }
    finally { check.pending = false; }
    if (response && !response.error && (response.data === 'left' || response.data === 'not_member')) {
      clear(); requireCurrent(); return response.data;
    }
    // Explicit PostgreSQL refusals never committed.
    if (response?.error && ['42501','P0001','23503','23514','22P02','42883'].includes(response.error.code)) {
      clear(); requireCurrent(); throw response.error;
    }
  }

  requireCurrent();
  let status;
  try {
    status = await requestWithDeadline(supabase.rpc('is_circle_member', { p_circle_id: circleId, p_user_id: userId }), 8000);
  } catch { /* Leave the decision pending for an explicit read-only check. */ }
  requireCurrent();
  if (status?.error || typeof status?.data !== 'boolean' || store.get(key) !== check) throw new CircleLeaveUnconfirmed();
  clear();
  if (!status.data) return 'not_member';
  // A confirmed current membership (including a later rejoin) needs a new,
  // deliberate decision. A status check never dispatches a second leave.
  throw new Error('This membership is still active.');
}
