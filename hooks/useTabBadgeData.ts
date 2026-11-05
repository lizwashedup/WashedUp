import { useQuery } from '@tanstack/react-query';
import { useObservedUser } from './useObservedUser';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { UNREAD_CHATS_KEY } from '../constants/QueryKeys';
import { YOURS_PAGE_ENABLED } from '../constants/FeatureFlags';
import { getRequestsSeenAt, REQUESTS_BADGE_KEY } from '../lib/yours/requestsSeen';

/** Account-owned badge reads; prefix keys keep existing invalidation working. */
export function useTabBadgeData() {
  const viewer = useObservedUser();
  const ready = !!viewer.viewerId && !viewer.isLoading && !viewer.error && viewer.isCurrent();
  const userId = ready ? viewer.viewerId! : null;
  const current = () => {
    if (!userId || !viewer.isCurrent()) throw new Error('Obsolete tab badge read');
  };
  const unread = useQuery({
    queryKey: [...UNREAD_CHATS_KEY, userId, viewer.epoch],
    enabled: !!userId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      current();
      const [notices, memberships] = await requestWithDeadline(Promise.all([
        supabase.from('app_notifications').select('event_id').eq('user_id', userId!).eq('type', 'new_message').eq('status', 'unread'),
        supabase.from('event_members').select('event_id').eq('user_id', userId!).eq('status', 'joined'),
      ]), 12_000);
      current();
      if (notices.error) throw notices.error;
      if (memberships.error) throw memberships.error;
      if (!Array.isArray(notices.data) || !Array.isArray(memberships.data)) throw new Error('Unread chats unavailable');
      // Preserve distinct joined-event counting; departed/unopened chats do not count.
      const joined = new Set(memberships.data.map(row => row.event_id));
      return new Set(notices.data.map(row => row.event_id).filter(id => joined.has(id))).size;
    },
  });
  const invites = useQuery({
    queryKey: ['pending-invites-badge', userId, viewer.epoch],
    enabled: !!userId,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      current();
      const response = await requestWithDeadline(supabase.from('plan_invites').select('id', { count: 'exact', head: true }).eq('recipient_id', userId!).eq('status', 'pending'), 12_000);
      current();
      if (response.error) throw response.error;
      if (typeof response.count !== 'number' || !Number.isInteger(response.count) || response.count < 0) throw new Error('Invitations unavailable');
      return response.count > 0;
    },
  });
  const requests = useQuery({
    queryKey: [...REQUESTS_BADGE_KEY, userId, viewer.epoch],
    enabled: !!userId && YOURS_PAGE_ENABLED,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      current();
      const response = await requestWithDeadline(supabase.rpc('get_incoming_people_requests', { p_user_id: userId! }), 12_000);
      current();
      if (response.error) throw response.error;
      if (!Array.isArray(response.data)) throw new Error('People requests unavailable');
      const seen = await requestWithDeadline(getRequestsSeenAt(userId!), 12_000);
      current();
      return response.data.filter((row: { requested_at?: string }) => {
        const time = Date.parse(row?.requested_at ?? '');
        return Number.isFinite(time) && time > seen;
      }).length;
    },
  });
  return {
    unreadChats: ready ? unread.data ?? 0 : 0,
    hasPendingInvites: ready ? invites.data ?? false : false,
    pendingRequests: ready && YOURS_PAGE_ENABLED ? requests.data ?? 0 : 0,
  };
}
