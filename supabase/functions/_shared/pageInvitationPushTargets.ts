/** Exact page metadata at the dispatch boundary. Ordinary notifications never enter this RPC. */
export interface PageInvitationNotice { id: string; user_id: string; type: string; }
export interface PageInvitationPushTarget { notification_id: string; page_id: string; invitation_id: string; user_id: string; eligible: boolean; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function resolvePageInvitationPushTargets(database: { rpc: (name: string, args: any) => PromiseLike<any> }, notices: PageInvitationNotice[]) {
  const updates = notices.filter(n => n.type === 'page_team_invitation');
  const targets = new Map<string, PageInvitationPushTarget>();
  if (!updates.length) return targets;
  const expected = new Map(updates.map(n => [n.id,n]));
  if (expected.size !== updates.length) throw new Error('Duplicate page update in claimed batch');
  const result = await database.rpc('get_page_invitation_push_targets', { p_notification_ids: updates.map(n => n.id) });
  if (result.error || !Array.isArray(result.data)) throw new Error('Page update targets could not be confirmed');
  for (const row of result.data) {
    const notice = expected.get(row?.notification_id);
    if (!notice || targets.has(notice.id) || row.user_id !== notice.user_id || typeof row.page_id !== 'string' || !uuid.test(row.page_id)
      || typeof row.invitation_id !== 'string' || !uuid.test(row.invitation_id) || typeof row.eligible !== 'boolean') throw new Error('Page update target did not match its notification');
    targets.set(notice.id,row);
  }
  if (targets.size !== expected.size) throw new Error('Page update target is missing');
  return targets;
}
export function pageInvitationPushData(target: PageInvitationPushTarget) {
  return { type: 'page_team_invitation', notificationId: target.notification_id, creatorPageId: target.page_id, pageInvitationId: target.invitation_id };
}
