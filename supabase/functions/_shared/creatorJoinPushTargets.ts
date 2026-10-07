/** Re-resolve exact current-page join sources immediately before provider dispatch. */
export interface CreatorJoinNotice { id: string; user_id: string; type: string; }
export interface CreatorJoinTarget { notification_id: string; user_id: string; legacy: boolean; page_id: string | null; member_id: string | null; kind: string | null; eligible: boolean; }
const kinds = new Map([['community_join_request', 'request'], ['community_join_approved', 'approved'], ['community_join_declined', 'declined']]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isCreatorJoinNotice(notice: { type: string }) { return kinds.has(notice.type); }
export async function resolveCreatorJoinPushTargets(database: { rpc: (name: string, args: any) => PromiseLike<any> }, notices: CreatorJoinNotice[]) {
  const joins = notices.filter(isCreatorJoinNotice);
  const targets = new Map<string, CreatorJoinTarget>();
  if (!joins.length) return targets;
  const expected = new Map(joins.map(n => [n.id, n]));
  if (expected.size !== joins.length) throw new Error('Duplicate join notification');
  const result = await database.rpc('get_creator_page_join_push_targets', { p_notification_ids: joins.map(n => n.id) });
  if (result.error || !Array.isArray(result.data)) throw new Error('Join notification sources could not be confirmed');
  for (const row of result.data) {
    const notice = expected.get(row?.notification_id);
    if (!notice || targets.has(notice.id) || row.user_id !== notice.user_id || typeof row.eligible !== 'boolean'
      || typeof row.legacy !== 'boolean' || (row.legacy
        ? row.page_id !== null || row.member_id !== null || row.kind !== null || row.eligible !== true
        : typeof row.page_id !== 'string' || !uuid.test(row.page_id) || typeof row.member_id !== 'string' || !uuid.test(row.member_id) || row.kind !== kinds.get(notice.type)))
      throw new Error('Join notification source did not match its recipient');
    targets.set(notice.id, row);
  }
  if (targets.size !== expected.size) throw new Error('Join notification source is missing');
  return targets;
}
export function creatorJoinPushData(target: CreatorJoinTarget) {
  if (target.legacy || !target.page_id || !target.member_id || !target.kind) throw new Error('Exact join source required');
  return { type: 'community_join_' + target.kind, notificationId: target.notification_id, creatorPageId: target.page_id, communityMemberId: target.member_id };
}
