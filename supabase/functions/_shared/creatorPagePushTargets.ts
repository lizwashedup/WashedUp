/** Exact page metadata at the dispatch boundary. Ordinary notifications never enter this RPC. */
export interface PageUpdateNotice { id: string; user_id: string; type: string; }
export interface CreatorPagePushTarget { notification_id: string; page_id: string; broadcast_id: string; user_id: string; eligible: boolean; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function resolveCreatorPagePushTargets(database: { rpc: (name: string, args: any) => PromiseLike<any> }, notices: PageUpdateNotice[]) {
  const updates = notices.filter(n => n.type === 'creator_page_update');
  const targets = new Map<string, CreatorPagePushTarget>();
  if (!updates.length) return targets;
  const expected = new Map(updates.map(n => [n.id,n]));
  if (expected.size !== updates.length) throw new Error('Duplicate page update in claimed batch');
  const result = await database.rpc('get_creator_page_push_targets', { p_notification_ids: updates.map(n => n.id) });
  if (result.error || !Array.isArray(result.data)) throw new Error('Page update targets could not be confirmed');
  for (const row of result.data) {
    const notice = expected.get(row?.notification_id);
    if (!notice || targets.has(notice.id) || row.user_id !== notice.user_id || typeof row.page_id !== 'string' || !uuid.test(row.page_id)
      || typeof row.broadcast_id !== 'string' || !uuid.test(row.broadcast_id) || typeof row.eligible !== 'boolean') throw new Error('Page update target did not match its notification');
    targets.set(notice.id,row);
  }
  if (targets.size !== expected.size) throw new Error('Page update target is missing');
  return targets;
}
export function creatorPagePushData(target: CreatorPagePushTarget) {
  return { type: 'creator_page_update', notificationId: target.notification_id, creatorPageId: target.page_id, creatorPageBroadcastId: target.broadcast_id };
}
