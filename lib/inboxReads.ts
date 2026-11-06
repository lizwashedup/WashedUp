import { supabase } from './supabase';
import { loadAttendeeNoticeLinks } from './attendeeMessageNotification';
import { isTransportErrorMessage } from './friendlyError';
import { requestWithDeadline, RequestDeadlineError } from './requestWithDeadline';

type Scope = { userId: string | null; isCurrent: () => boolean };

// A network interruption can retain the last confirmed list for this account.
// An access denial or an invalid response replaces it with an unavailable state.
async function inboxRows<T>(request: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[] | null> {
  try {
    const { data, error } = await requestWithDeadline(request, 12_000);
    if (error) throw error;
    return Array.isArray(data) ? data : null;
  } catch (failure) {
    const error = failure as { message?: string; code?: string };
    if (failure instanceof RequestDeadlineError || error?.code === 'NETWORK'
      || (!error?.code && isTransportErrorMessage(error?.message ?? ''))) throw failure;
    return null;
  }
}

async function inboxProfiles(ids: string[]) {
  if (!ids.length) return new Map();
  try {
    const response = await requestWithDeadline(supabase.from('profiles_public')
      .select('id, first_name_display, profile_photo_url').in('id', ids), 2500);
    return new Map((response.error ? [] : response.data ?? []).map(person => [person.id, person]));
  } catch {
    return new Map();
  }
}

export async function readInboxInvitations(scope: Scope) {
  if (!scope.userId || !scope.isCurrent()) return null;
  const rows = await inboxRows(supabase.from('plan_invites')
    .select('id, event_id, sender_id, status, created_at, events (id, title, start_time, status, member_count, max_invites)')
    .eq('recipient_id', scope.userId).eq('status', 'pending').order('created_at', { ascending: false }));
  if (!rows || !scope.isCurrent()) return null;
  const active = rows.filter((invite: any) => ['forming', 'active', 'full'].includes(invite.events?.status));
  const senders = await inboxProfiles([...new Set(active.map(invite => invite.sender_id).filter(Boolean))]);
  if (!scope.isCurrent()) return null;
  return active.map(invite => ({ ...invite, profiles: senders.get(invite.sender_id) ?? null }));
}

export async function readInboxNotifications(scope: Scope) {
  if (!scope.userId || !scope.isCurrent()) return null;
  // The query also enforces expiry, so a stalled cleanup cannot block the list.
  void requestWithDeadline(supabase.rpc('expire_stale_notifications'), 2500).catch(() => {});
  const rows = await inboxRows(supabase.from('app_notifications')
    .select('id, type, title, body, event_id, actor_user_id, status, expires_at, created_at')
    .eq('user_id', scope.userId).eq('status', 'unread').neq('type', 'plan_invite').neq('type', 'new_message')
    .or('expires_at.is.null,expires_at.gt.now()').order('created_at', { ascending: false }).limit(30));
  if (!rows || !scope.isCurrent()) return null;
  const sceneIds = rows.filter(row => row.type === 'broadcast' && !row.event_id).map(row => row.id);
  const actorIds = rows.filter(row => row.type !== 'creator_page_update' && row.type !== 'page_team_invitation')
    .map(row => row.actor_user_id).filter((id): id is string => !!id);
  const [targets, actors] = await Promise.all([
    sceneIds.length ? requestWithDeadline(loadAttendeeNoticeLinks(sceneIds, {userId:scope.userId, isCurrent:scope.isCurrent}), 2500).catch(() => null) : new Map(),
    inboxProfiles([...new Set(actorIds)]),
  ]);
  if (!scope.isCurrent()) return null;
  return rows.map(row => ({
    ...row,
    scene_update: targets ? !!targets.get(row.id) : row.type === 'broadcast' && !row.event_id,
    sender_photo: row.type === 'creator_page_update' || row.type === 'page_team_invitation' ? null : actors.get(row.actor_user_id)?.profile_photo_url ?? null,
  }));
}
