/** Exact-page membership review. Reuses the existing admission routine; no member removal or role changes. */
export interface MembershipScope { userId: string; isCurrent(): boolean }
export interface MembershipRequest {
  memberId: string; userId: string; status: string; createdAt: string; updatedAt: string;
  firstName: string; lastName: string; introduction: string; reason: string; source: string;
  question: string; answer: string; rulesConfirmed: boolean | null; guidelinesAcceptedAt: string | null;
}
export interface MembershipInbox { pageId: string; pageName: string; requests: MembershipRequest[]; nextCursor: string | null }
export interface MembershipDecision { pageId: string; memberId: string; approve: boolean; updatedAt: string }
export const membershipUUID = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const statuses = ['pending', 'active', 'declined', 'left', 'removed', 'banned'];
function current(scope: MembershipScope, pageId: string) {
  if (!membershipUUID(pageId) || !membershipUUID(scope.userId) || !scope.isCurrent()) throw Error('This page visit has changed.');
}
function parseRequest(raw: unknown): MembershipRequest {
  const fail = () => Error('This request could not be confirmed.');
  if (!object(raw) || !membershipUUID(raw.member_id) || !membershipUUID(raw.user_id) || !statuses.includes(raw.status as string)
    || typeof raw.created_at !== 'string' || !Number.isFinite(Date.parse(raw.created_at)) || typeof raw.updated_at !== 'string' || !Number.isFinite(Date.parse(raw.updated_at))) throw fail();
  const text = (key: string): string => { if (raw[key] === null) return ''; if (typeof raw[key] !== 'string') throw fail(); return raw[key] as string; };
  if (raw.rules_confirmed !== null && typeof raw.rules_confirmed !== 'boolean') throw fail();
  if (raw.guidelines_accepted_at !== null && (typeof raw.guidelines_accepted_at !== 'string' || !Number.isFinite(Date.parse(raw.guidelines_accepted_at)))) throw fail();
  return { memberId: raw.member_id, userId: raw.user_id, status: raw.status as string, createdAt: raw.created_at, updatedAt: raw.updated_at,
    firstName: text('first_name'), lastName: text('last_name'), introduction: text('intro_answer'), reason: text('reason_answer'), source: text('source_answer'),
    question: text('open_question'), answer: text('open_answer'), rulesConfirmed: raw.rules_confirmed as boolean | null, guidelinesAcceptedAt: raw.guidelines_accepted_at as string | null };
}
export function createMembershipRequestsApi(rpc: (name: string, args: Record<string, unknown>, scope: MembershipScope) => Promise<unknown>) {
  return {
    async read(pageId: string, scope: MembershipScope, query: { memberId?: string; afterId?: string } = {}): Promise<MembershipInbox> {
      current(scope, pageId);
      if ((query.memberId && !membershipUUID(query.memberId)) || (query.afterId && !membershipUUID(query.afterId)) || (query.memberId && query.afterId)) throw Error('Choose one request or a list.');
      const raw = await rpc('get_creator_page_join_requests', { p_page_id: pageId, p_member_id: query.memberId ?? null, p_after_id: query.afterId ?? null }, scope);
      current(scope, pageId);
      if (!object(raw) || raw.page_id !== pageId || typeof raw.page_name !== 'string' || !raw.page_name.trim() || !Array.isArray(raw.requests)
        || (raw.next_cursor !== null && !membershipUUID(raw.next_cursor))) throw Error('Page requests could not be confirmed.');
      const requests = raw.requests.map(parseRequest);
      if (requests.length > (query.memberId ? 1 : 50) || new Set(requests.map(r => r.memberId)).size !== requests.length
        || requests.some(r => query.memberId ? r.memberId !== query.memberId : r.status !== 'pending')
        || (query.memberId && raw.next_cursor !== null)
        || (raw.next_cursor !== null && (requests.length !== 50 || requests[49].memberId !== raw.next_cursor))) throw Error('Page requests could not be confirmed.');
      return { pageId, pageName: raw.page_name, requests, nextCursor: raw.next_cursor as string | null };
    },
    async decide(decision: MembershipDecision, scope: MembershipScope) {
      current(scope, decision.pageId);
      if (!membershipUUID(decision.memberId) || typeof decision.approve !== 'boolean' || !Number.isFinite(Date.parse(decision.updatedAt))) throw Error('Choose a request and decision.');
      const raw = await rpc('review_creator_page_join_request', { p_page_id: decision.pageId, p_member_id: decision.memberId, p_approve: decision.approve, p_expected_updated_at: decision.updatedAt }, scope);
      current(scope, decision.pageId);
      if (!object(raw) || raw.page_id !== decision.pageId || raw.member_id !== decision.memberId || raw.status !== (decision.approve ? 'active' : 'declined') || typeof raw.changed !== 'boolean') throw Error('The decision is unconfirmed. Check its saved status.');
      return { status: raw.status as 'active' | 'declined', changed: raw.changed };
    },
  };
}
/** Save only the decision identifiers, never private answers. A remount checks status without resending. */
export function createMembershipDecisionStore(storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }) {
  const key = (pageId: string, scope: MembershipScope) => `creator-membership-decision:v1:${scope.userId}:${pageId}`;
  const read = async (pageId: string, scope: MembershipScope): Promise<MembershipDecision | null> => {
    current(scope, pageId); const raw = await storage.getItem(key(pageId, scope)); current(scope, pageId);
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (!object(value) || value.pageId !== pageId || !membershipUUID(value.memberId) || typeof value.approve !== 'boolean' || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) throw Error('The saved decision could not be read.');
    return { pageId, memberId: value.memberId, approve: value.approve, updatedAt: value.updatedAt };
  };
  const queues = new Map<string, Promise<void>>();
  const serial = <T>(pageId: string, scope: MembershipScope, action: () => Promise<T>): Promise<T> => {
    const storageKey = key(pageId, scope);
    const result = (queues.get(storageKey) ?? Promise.resolve()).then(() => { current(scope, pageId); return action(); });
    const tail = result.then(() => {}, () => {});
    queues.set(storageKey, tail);
    void tail.then(() => { if (queues.get(storageKey) === tail) queues.delete(storageKey); });
    return result;
  };
  return { read: (pageId: string, scope: MembershipScope) => serial(pageId, scope, () => read(pageId, scope)),
    prepare: (decision: MembershipDecision, scope: MembershipScope) => serial(decision.pageId, scope, async () => {
    current(scope, decision.pageId);
    if (!membershipUUID(decision.memberId) || typeof decision.approve !== 'boolean' || !Number.isFinite(Date.parse(decision.updatedAt))) throw Error('Invalid decision.');
    const old = await read(decision.pageId, scope);
    if (old && (old.memberId !== decision.memberId || old.approve !== decision.approve || old.updatedAt !== decision.updatedAt)) throw Error('Check the previous decision first.');
    await storage.setItem(key(decision.pageId, scope), JSON.stringify(decision)); current(scope, decision.pageId);
  }), clear: (decision: MembershipDecision, scope: MembershipScope) => serial(decision.pageId, scope, async () => {
    const old = await read(decision.pageId, scope);
    if (old?.memberId === decision.memberId && old.approve === decision.approve && old.updatedAt === decision.updatedAt) await storage.removeItem(key(decision.pageId, scope));
    current(scope, decision.pageId);
  }) };
}
