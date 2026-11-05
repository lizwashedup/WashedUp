import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useObservedUser } from './useObservedUser';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { INBOX_COUNT_KEY, PROFILE_PHOTO_KEY } from '../constants/QueryKeys';
/** Header reads belong to the currently observed account generation. Prefix
 * keys retain existing photo/inbox invalidation across every mounted header. */
export function useProfileHeaderData(compact = false) {
  const viewer = useObservedUser();
  const ready = !!viewer.viewerId && !viewer.isLoading && !viewer.error && viewer.isCurrent();
  const userId = ready ? viewer.viewerId! : null;
  const current = () => {
    if (!userId || !viewer.isCurrent()) throw new Error('Obsolete header read');
  };
  const photo = useQuery({
    queryKey: [...PROFILE_PHOTO_KEY, userId, viewer.epoch],
    enabled: !!userId,
    staleTime: 30000,
    queryFn: async (): Promise<string | null> => {
      current();
      const response = await requestWithDeadline(supabase.from('profiles').select('profile_photo_url').eq('id', userId!).single(), 12000);
      current();
      if (response.error) throw response.error;
      return response.data?.profile_photo_url ?? null;
    }
  });
  const inbox = useQuery({
    queryKey: [...INBOX_COUNT_KEY, userId, viewer.epoch],
    enabled: !!userId && !compact,
    staleTime: 30000,
    refetchInterval: 60000,
    queryFn: async (): Promise<number> => {
      current();
      const [invites, notices] = await requestWithDeadline(Promise.all([supabase.from('plan_invites').select('id, events!inner(status)').eq('recipient_id', userId!).eq('status', 'pending').in('events.status', ['forming', 'active', 'full']),
      // Match the inbox's existing exclusions and expiry rules.
      supabase.from('app_notifications').select('id', {
        count: 'exact',
        head: true
      }).eq('user_id', userId!).eq('status', 'unread').neq('type', 'plan_invite').neq('type', 'new_message').or('expires_at.is.null,expires_at.gt.now()')]), 12000);
      current();
      if (invites.error) throw invites.error;
      if (notices.error) throw notices.error;
      if (!Array.isArray(invites.data) || typeof notices.count !== 'number' || !Number.isInteger(notices.count) || notices.count < 0) throw new Error('Inbox count unavailable');
      return invites.data.length + notices.count;
    }
  });
  const refetchPhoto = useCallback(async () => {
    if (ready && viewer.isCurrent()) await photo.refetch();
  }, [ready, viewer.isCurrent, photo.refetch]);
  return {
    userId,
    epoch: viewer.epoch,
    isCurrent: viewer.isCurrent,
    photoUrl: ready ? photo.data ?? null : null,
    inboxCount: ready && !compact ? inbox.data ?? 0 : 0,
    refetchPhoto
  };
}
