import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { yoursKeys } from '../lib/yours/keys';
import type { BacklogPerson } from '../lib/yours/types';

/** People you've completed a plan with, not yet connected. */
export function usePlanHistoryBacklog(userId: string | null | undefined) {
  return useQuery({
    queryKey: yoursKeys.backlog(userId ?? ''),
    enabled: !!userId,
    queryFn: async (): Promise<BacklogPerson[]> => {
      const { data, error } = await supabase.rpc('get_plan_history_backlog', {
        p_user_id: userId,
      });
      if (error) throw error;
      return (data ?? []) as BacklogPerson[];
    },
  });
}
