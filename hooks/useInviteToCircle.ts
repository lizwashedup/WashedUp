/**
 * useInviteToCircle - add people to a circle (spec section 3, admin-gated).
 *
 * Wraps invite_to_circle(p_circle_id, p_user_ids) -> int (rows added). The
 * caller must be a circle admin (the creator always is; 'everyone'-policy
 * circles make every member one). Invalidates the circle detail (so the new
 * faces appear in "who's in it") and the directory (member counts).
 *
 * This is the machinery behind the circle header "+" -> Add people, the detail
 * page "add" affordance, AND growing a 2-person DM into a circle (a 3rd person).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { circleKeys } from '../lib/circles/keys';

export function useInviteToCircle(
  circleId: string,
  userId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberUserIds: string[]): Promise<number> => {
      const { data, error } = await supabase.rpc('invite_to_circle', {
        p_circle_id: circleId,
        p_user_ids: memberUserIds,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: circleKeys.detail(circleId) });
      if (userId) qc.invalidateQueries({ queryKey: circleKeys.mine(userId) });
    },
  });
}
