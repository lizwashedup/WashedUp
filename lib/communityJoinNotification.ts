import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';

export const communityJoinNoticeTypes = ['community_join_request', 'community_join_approved', 'community_join_declined'] as const;
export type CommunityJoinNoticeType = typeof communityJoinNoticeTypes[number];
export type JoinNoticeScope = { userId: string | null; isCurrent(): boolean };
export type CommunityJoinNoticeTarget = { notification_id: string; page_id: string; member_id: string; kind: 'request' | 'approved' | 'declined'; eligible: boolean };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export const isCommunityJoinNotice = (type: unknown): type is CommunityJoinNoticeType => communityJoinNoticeTypes.includes(type as CommunityJoinNoticeType);
const kindFor = (type: CommunityJoinNoticeType) => type.slice('community_join_'.length);
export function communityJoinNoticeRoute(target: CommunityJoinNoticeTarget): string {
  if (!uuid(target.notification_id) || !uuid(target.page_id) || !uuid(target.member_id) || !['request', 'approved', 'declined'].includes(target.kind) || target.eligible !== true) throw Error('This community update is no longer available.');
  return target.kind === 'request' ? `/creator/page-requests?id=${target.page_id}` : `/community/${target.page_id}`;
}
/** Legacy notices intentionally retain their existing branch; malformed new sources never fall into it. */
export function communityJoinPushRoute(data: Record<string, unknown>, enabled: boolean): string | null {
  if (!isCommunityJoinNotice(data.type)) return null;
  if (!Object.prototype.hasOwnProperty.call(data, 'creatorPageId') && !Object.prototype.hasOwnProperty.call(data, 'communityMemberId')) return null;
  const fallback = data.type === 'community_join_request' ? '/(tabs)/friends' : '/(tabs)/explore';
  if (!enabled || !uuid(data.notificationId) || !uuid(data.creatorPageId) || !uuid(data.communityMemberId)) return fallback;
  return communityJoinNoticeRoute({ notification_id: data.notificationId, page_id: data.creatorPageId, member_id: data.communityMemberId, kind: kindFor(data.type) as CommunityJoinNoticeTarget['kind'], eligible: true });
}
export class CommunityJoinNoticeIdentityError extends Error {
  constructor(message: string) { super(message); this.name = 'CommunityJoinNoticeIdentityError'; }
}
const current = (scope: JoinNoticeScope) => { if (!scope.isCurrent()) throw new CommunityJoinNoticeIdentityError('This update is no longer open.'); };
async function authorization(scope: JoinNoticeScope): Promise<string> {
  current(scope);
  let result;
  try { result = await requestWithDeadline(supabase.auth.getSession(), 12_000); }
  catch { throw new CommunityJoinNoticeIdentityError('Couldn’t check your account. Try again.'); }
  current(scope);
  if (result.error || !scope.userId || result.data.session?.user.id !== scope.userId || !result.data.session.access_token) throw new CommunityJoinNoticeIdentityError('Sign in to open this community update.');
  return `Bearer ${result.data.session.access_token}`;
}
export async function loadCommunityJoinNotice(id: string, type: CommunityJoinNoticeType, scope: JoinNoticeScope): Promise<CommunityJoinNoticeTarget | null> {
  if (!uuid(id) || !isCommunityJoinNotice(type)) throw Error('This community update could not be checked.');
  const token = await authorization(scope);
  const result = await requestWithDeadline(supabase.rpc('get_my_creator_page_join_notice', { p_notification_id: id }).setHeader('Authorization', token), 12_000);
  await authorization(scope);
  if (result.error) throw Error('Couldn’t check this community update. Try again.');
  if (result.data === null) return null;
  const data = result.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.notification_id !== id || !uuid(data.page_id) || !uuid(data.member_id) || data.kind !== kindFor(type) || typeof data.eligible !== 'boolean') throw Error('This community update could not be confirmed.');
  return data as CommunityJoinNoticeTarget;
}
/** Optional read bookkeeping is bounded; identity validation is never optional. */
export async function markCommunityJoinNoticeRead(id: string, type: CommunityJoinNoticeType, scope: JoinNoticeScope, status: 'read' | 'acted' = 'read'): Promise<void> {
  if (!uuid(id) || !isCommunityJoinNotice(type)) throw Error('This community update could not be checked.');
  const token = await authorization(scope);
  const result = await requestWithDeadline(supabase.from('app_notifications').update({ status }).eq('id', id).eq('user_id', scope.userId).eq('type', type).select('id').setHeader('Authorization', token).maybeSingle(), 12_000).catch(() => null);
  await authorization(scope);
  if (!result || result.error || result.data?.id !== id) throw Error('Couldn’t mark this update read.');
}
