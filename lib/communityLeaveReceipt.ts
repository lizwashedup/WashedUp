import { getMyMembership, leaveCommunity } from './communityJoin';
import { requestWithDeadline } from './requestWithDeadline';

// A route visit may end before the server replies. Keep its unresolved decision
// with the query client, never with the next screen or a different account.
type Decision = { pending: boolean; confirmed: boolean; refusal?: unknown; membershipId?: string };
const decisions = new WeakMap<object, Map<string, Decision>>();
const keyFor = (userId: string, communityId: string) => JSON.stringify([userId, communityId]);
const definiteRefusal = (error: unknown) => !!error && typeof error === 'object' && 'code' in error
  && ['42501', 'P0001', '23503', '23514', '22P02', '42883'].includes(String(error.code));

export class CommunityLeaveUnconfirmed extends Error {
  constructor() {
    super('We couldn’t confirm whether you left. Check your status before making another request.');
    this.name = 'CommunityLeaveUnconfirmed';
  }
}
export function hasCommunityLeaveDecision(client: object, userId: string, communityId: string): boolean {
  return decisions.get(client)?.has(keyFor(userId, communityId)) ?? false;
}

export async function leaveCommunityWithReceipt(client: object, userId: string, communityId: string,
  requireCurrent: () => void, membershipId?: string, checkOnly = false): Promise<void> {
  requireCurrent();
  let store = decisions.get(client);
  if (!store) { store = new Map(); decisions.set(client, store); }
  const key = keyFor(userId, communityId);
  const prior = store.get(key);
  const decision = prior ?? { pending: !checkOnly, confirmed: false, membershipId };
  if (!prior) store.set(key, decision);
  const clear = () => { if (store.get(key) === decision) store.delete(key); };
  if (!prior && !checkOnly) {
    // A deadline bounds feedback, not the write: do not abort or retry it.
    const write = leaveCommunity(communityId)
      .then(() => { decision.confirmed = true; }, error => {
        if (definiteRefusal(error)) decision.refusal = error;
      }).finally(() => { decision.pending = false; });
    try { await requestWithDeadline(write, 12_000); } catch { /* Explicit Check owns recovery. */ }
  }
  requireCurrent();
  if (decision.confirmed) { clear(); return; } // void/null is the documented success receipt.
  if (decision.refusal) { clear(); throw decision.refusal; }
  if (decision.pending) throw new CommunityLeaveUnconfirmed();

  let membership;
  try { membership = await requestWithDeadline(getMyMembership(communityId, userId), 8_000); }
  catch { requireCurrent(); throw new CommunityLeaveUnconfirmed(); }
  requireCurrent();
  if (store.get(key) !== decision) throw new CommunityLeaveUnconfirmed();
  // Missing/active/replacement rows do not prove an uncertain leave cannot
  // still arrive. Only an explicit own-row departure resolves a lost reply.
  if (membership && (!decision.membershipId || membership.id === decision.membershipId)
    && ['left', 'removed', 'banned'].includes(membership.status)) {
    clear(); return;
  }
  throw new CommunityLeaveUnconfirmed();
}
