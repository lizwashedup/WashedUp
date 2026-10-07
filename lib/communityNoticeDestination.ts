import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';
import { communityChatPushRoute } from './communityChatPushRoute';
export type CommunityNoticeScope = { userId: string | null; isCurrent(): boolean };
const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
class CommunityNoticeIdentityError extends Error {
  constructor(message: string) { super(message); this.name = 'CommunityNoticeIdentityError'; }
}
const current = (scope: CommunityNoticeScope) => { if (!scope.isCurrent()) throw new CommunityNoticeIdentityError('This notification is no longer open.'); };
async function authorization(scope: CommunityNoticeScope): Promise<string> {
  current(scope);
  let result;
  try { result = await requestWithDeadline(supabase.auth.getSession(), 12_000); }
  catch { throw new CommunityNoticeIdentityError('Couldn’t check your account. Try again.'); }
  current(scope);
  if (result.error || !scope.userId || result.data.session?.user.id !== scope.userId || !result.data.session.access_token) throw new CommunityNoticeIdentityError('Sign in to open this conversation.');
  return `Bearer ${result.data.session.access_token}`;
}
export async function loadCommunityNoticeRoute(notificationId: string, scope: CommunityNoticeScope): Promise<string | null> {
  if (!isId(notificationId)) throw new Error('This notification could not be checked.');
  const token = await authorization(scope);
  const result = await requestWithDeadline(supabase.rpc('get_my_community_notice_target', { p_notification_id: notificationId }).setHeader('Authorization', token), 12_000);
  await authorization(scope);
  if (result.error) throw new Error('Couldn’t open this conversation. Try again.');
  if (result.data === null) return null;
  const data = result.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.notificationId !== notificationId || data.type !== 'community_broadcast') throw new Error('This notification could not be checked.');
  const route = communityChatPushRoute(data, true);
  if (!route || !/^\/community-(thread|topic)\//.test(route)) throw new Error('This notification could not be checked.');
  return route;
}
export async function markCommunityNoticeRead(notificationId: string, scope: CommunityNoticeScope): Promise<void> {
  if (!isId(notificationId)) throw new Error('This notification could not be checked.');
  const token = await authorization(scope);
  const result = await requestWithDeadline(supabase.from('app_notifications').update({ status: 'read' })
    .eq('id', notificationId).eq('user_id', scope.userId!).select('id').maybeSingle().setHeader('Authorization', token), 12_000).catch(() => null);
  await authorization(scope);
  if (!result || result.error || result.data?.id !== notificationId) throw new Error('Couldn’t dismiss this notification. Try again.');
}
