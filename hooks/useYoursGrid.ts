import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { yoursKeys } from '../lib/yours/keys';
import type { YoursGridPerson } from '../lib/yours/types';

/** Accepted people, with activity ring, milestone, upcoming-plan pill. */
export function useYoursGrid(userId: string | null | undefined) {
  return useQuery({
    queryKey: yoursKeys.grid(userId ?? ''),
    enabled: !!userId,
    queryFn: async (): Promise<YoursGridPerson[]> => {
      const { data, error } = await supabase.rpc('get_yours_grid', {
        p_user_id: userId,
      });
      if (error) throw error;
      return (data ?? []) as YoursGridPerson[];
    },
  });
}
