import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';
import type { PageImageScope } from './publishedPageCover';
export interface OrganizationPageUpdateTarget { notificationId: string; pageId: string; broadcastId: string; }
export interface OrganizationPageUpdate { id: string; pageId: string; body: string; createdAt: string; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === 'string' && uuid.test(v);
export class OrganizationUpdateIdentityError extends Error {
  constructor(message: string) { super(message); this.name = 'OrganizationUpdateIdentityError'; }
}
const current = (scope: PageImageScope) => {
  if (!scope.isCurrent()) throw new OrganizationUpdateIdentityError('This update is no longer open.');
};
async function authorization(scope: PageImageScope) {
  current(scope);
  let result;
  try { result = await requestWithDeadline(supabase.auth.getSession(), 12_000); }
  catch { throw new OrganizationUpdateIdentityError('Couldn’t check your account. Try again.'); }
  current(scope);
  const session = result.data.session;
  if (result.error || !scope.userId || session?.user.id !== scope.userId || !session.access_token)
    throw new OrganizationUpdateIdentityError('Sign in to read this update.');
  return `Bearer ${session.access_token}`;
}
export function organizationPageUpdateRoute(target: Pick<OrganizationPageUpdateTarget,'pageId'|'broadcastId'>) {
  if (!isId(target.pageId) || !isId(target.broadcastId)) throw new Error('This update address is invalid.');
  return `/organization/${target.pageId}?identity=page&update=${target.broadcastId}`;
}
/** A page update is never passed to the legacy Plan/chat fallback, even when malformed or gated off. */
export function organizationPageUpdatePushRoute(data: Record<string, unknown>, enabled: boolean): string | null {
  if (data.type !== 'creator_page_update') return null;
  if (!enabled || !isId(data.creatorPageId) || !isId(data.creatorPageBroadcastId)) return '/(tabs)/explore';
  return organizationPageUpdateRoute({pageId:data.creatorPageId,broadcastId:data.creatorPageBroadcastId});
}
export async function loadOrganizationPageUpdateTarget(notificationId: string, scope: PageImageScope): Promise<OrganizationPageUpdateTarget | null> {
  if (!isId(notificationId) || !scope.userId) throw new Error('Sign in to open this update.');
  const token = await authorization(scope);
  const result = await requestWithDeadline(supabase.from('creator_page_broadcast_notifications').select('notification_id,page_id,broadcast_id,user_id')
    .eq('notification_id',notificationId).eq('user_id',scope.userId).setHeader('Authorization',token).maybeSingle(), 12_000);
  await authorization(scope);
  if (result.error) throw new Error('Couldn’t check this update. Try again.');
  const row = result.data;
  if (!row) return null;
  if (row.notification_id !== notificationId || row.user_id !== scope.userId || !isId(row.page_id) || !isId(row.broadcast_id)) throw new Error('This update could not be confirmed.');
  return {notificationId,pageId:row.page_id,broadcastId:row.broadcast_id};
}
export async function loadOrganizationPageUpdate(pageId: string, updateId: string, scope: PageImageScope): Promise<OrganizationPageUpdate | null> {
  if (!isId(pageId) || !isId(updateId)) throw new Error('This update address is invalid.');
  current(scope);
  if (!scope.userId) return null;
  const token = await authorization(scope);
  const result = await requestWithDeadline(supabase.from('follower_broadcasts').select('id,creator_page_id,body,created_at')
    .eq('id',updateId).eq('creator_page_id',pageId).setHeader('Authorization',token).maybeSingle(), 12_000);
  await authorization(scope);
  if (result.error) throw new Error('Couldn’t read this update. Try again.');
  const row = result.data;
  if (!row) return null;
  if (row.id !== updateId || row.creator_page_id !== pageId || typeof row.body !== 'string' || typeof row.created_at !== 'string') throw new Error('This update could not be confirmed.');
  return {id:row.id,pageId:row.creator_page_id,body:row.body,createdAt:row.created_at};
}
/** Optional read bookkeeping still requires the initiating account and visit. */
export async function markOrganizationPageUpdateRead(notificationId: string, scope: PageImageScope) {
  if (!isId(notificationId) || !scope.userId) throw new OrganizationUpdateIdentityError('Sign in to read this update.');
  const token = await authorization(scope);
  const result = await requestWithDeadline(supabase.from('app_notifications').update({status:'read'})
    .eq('id',notificationId).eq('user_id',scope.userId).select('id').setHeader('Authorization',token).maybeSingle(),12_000).catch(() => null);
  await authorization(scope);
  if (!result || result.error || result.data?.id !== notificationId) throw new Error('Couldn’t mark this update as read.');
}
