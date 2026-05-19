import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { yoursKeys } from '../lib/yours/keys';
import { assertRpcShape, INCOMING_REQUEST_KEYS } from '../lib/yours/shapeGuard';
import type { IncomingRequest } from '../lib/yours/types';

/** Pending people requests addressed to me (banner + card stack). */
export function useIncomingRequests(userId: string | null | undefined) {
  return useQuery({
    queryKey: yoursKeys.requests(userId ?? ''),
    enabled: !!userId,
    queryFn: async (): Promise<IncomingRequest[]> => {
      const { data, error } = await supabase.rpc(
        'get_incoming_people_requests',
        { p_user_id: userId },
      );
      if (error) throw error;
      return assertRpcShape<IncomingRequest>(data, INCOMING_REQUEST_KEYS, 'get_incoming_people_requests');
    },
  });
}
