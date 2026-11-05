import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { yoursKeys } from '../lib/yours/keys';
import { assertRpcShape, INCOMING_REQUEST_KEYS } from '../lib/yours/shapeGuard';
import type { IncomingRequest } from '../lib/yours/types';

/** Pending people requests addressed to me (banner + card stack). */
export function useIncomingRequests(
  userId: string | null | undefined,
  scope: { userId: string; epoch: number; isCurrent(): boolean },
) {
  // The observer epoch starts over on remount. Keep each reader distinct too;
  // mutation invalidations still use the existing requests-key prefix.
  const reader = useId();
  return useQuery({
    queryKey: [...yoursKeys.requests(userId ?? ''), scope.epoch, reader],
    enabled: !!userId,
    retry: false,
    queryFn: async ({ signal }): Promise<IncomingRequest[]> => {
      const check = () => {
        if (signal.aborted || scope.userId !== userId || !scope.isCurrent()) throw new Error('This requests read is no longer current.');
      };
      check();
      const verified = await requestWithDeadline(supabase.auth.getUser(), 12_000);
      check();
      if (verified.error) throw verified.error;
      if (verified.data.user?.id !== userId) throw new Error('This account changed.');
      const request = supabase.rpc(
        'get_incoming_people_requests',
        { p_user_id: userId },
      );
      const { data, error } = await requestWithDeadline(Promise.resolve(request.abortSignal(signal)), 12_000);
      check();
      if (error) throw error;
      // An unavailable/malformed response must not become a false empty list
      // or reach RequestStack as rows that it cannot safely identify.
      if (!Array.isArray(data) || data.some(row => !row || typeof row !== 'object'
        || typeof row.connection_id !== 'string' || !row.connection_id
        || typeof row.requester_user_id !== 'string' || !row.requester_user_id
        || typeof row.requested_at !== 'string' || !row.requested_at)) {
        throw new Error('Could not load connection requests. Please try again.');
      }
      return assertRpcShape<IncomingRequest>(data, INCOMING_REQUEST_KEYS, 'get_incoming_people_requests');
    },
  });
}
