import { joinTopic, type CommunityOperationScope } from './communityChat';
import { getMyTopicMembership } from './eventTopicMembership';
import { requestWithDeadline } from './requestWithDeadline';

type Attempt = { pending: boolean; confirmed: boolean; refusal?: unknown };
// Session-local ownership survives route replacement, not a process restart.
// This legacy join is a unique insert with DO NOTHING on conflict, preserving
// existing notification preferences. No receipt schema is introduced here.
const attempts = new WeakMap<object, Map<string, Attempt>>();
const keyFor = (userId: string, communityId: string, topicId: string) => JSON.stringify([userId, communityId, topicId]);
const refused = (error: unknown) => !!error && typeof error === 'object' && 'code' in error
  && ['42501', 'P0001', '23503', '23514', '22P02', '42883'].includes(String(error.code));
export class LegacyTopicJoinUnconfirmed extends Error {
  constructor() { super('Your chat join hasn’t been confirmed. Check its status before trying again.'); }
}
export function hasLegacyTopicJoin(client: object, userId: string, communityId: string, topicId: string) {
  return attempts.get(client)?.has(keyFor(userId, communityId, topicId)) ?? false;
}
export async function joinLegacyTopicWithReceipt(client: object, communityId: string, topicId: string, scope: CommunityOperationScope): Promise<void> {
  const current = () => { if (!scope.isCurrent()) throw Error('This community visit changed.'); };
  current();
  let store = attempts.get(client);
  if (!store) { store = new Map(); attempts.set(client, store); }
  const key = keyFor(scope.userId, communityId, topicId), prior = store.get(key);
  const attempt = prior ?? { pending: true, confirmed: false };
  if (!prior) store.set(key, attempt);
  const clear = () => { if (store.get(key) === attempt) store.delete(key); };
  if (!prior) {
    // A UI deadline does not cancel a dispatched write. Retire any identity
    // continuation that has not yet dispatched; keep the unresolved attempt.
    let dispatchActive = true, dispatched = false;
    const write = joinTopic(topicId, { ...scope, isCurrent: () => dispatchActive && scope.isCurrent() }, () => { dispatched = true; })
      .then(() => { attempt.confirmed = true; }, error => { if (!dispatched || refused(error)) attempt.refusal = error; })
      .finally(() => { attempt.pending = false; });
    try { await requestWithDeadline(write, 12_000); } catch { /* Check is read-only. */ }
    finally { dispatchActive = false; }
    current();
    if (attempt.confirmed) { clear(); return; }
  }
  current();
  if (attempt.refusal) { clear(); throw attempt.refusal; }
  // A previous visit's receipt is not proof that membership still exists.
  // An empty read cannot prove an in-flight join will never arrive either.
  let joined = false;
  try { joined = await getMyTopicMembership(topicId, scope); }
  catch { current(); throw new LegacyTopicJoinUnconfirmed(); }
  current();
  if (joined) {
    if (!attempt.pending) clear();
    return;
  }
  throw new LegacyTopicJoinUnconfirmed();
}
