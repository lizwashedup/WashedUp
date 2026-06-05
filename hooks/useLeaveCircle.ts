/**
 * useLeaveCircle — leave a circle (spec section 3). Plan history is untouched;
 * the row just flips to status 'left'. Invalidates the directory so the circle
 * drops out of Yours > Circles on success.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { circleKeys } from '../lib/circles/keys';

export function useLeaveCircle(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (circleId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('leave_circle', {
        p_circle_id: circleId,
      });
      if (error) throw error;
      return data as string; // 'left' | 'not_member'
    },
    onSuccess: () => {
      if (userId) qc.invalidateQueries({ queryKey: circleKeys.mine(userId) });
    },
  });
}
