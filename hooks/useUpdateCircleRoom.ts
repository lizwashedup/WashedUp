/**
 * useUpdateCircleRoom - toggle The Room's opt-in for a circle.
 *
 * Spec (WashedUp_Circles_Functional_Spec.md section 3): "The Room (reserve
 * space, do not build)": an opt-in AI planning agent that is not active this
 * release. This hook flips only the reserved `room_enabled` flag on the
 * circles row; it does not read or write circle_briefs, circle_listener_state,
 * or planner_queue, and it starts no Room logic of any kind.
 *
 * Wraps the already-shipped update_circle(p_circle_id, p_room_enabled) RPC.
 * That is the same admin-gated RPC useUpdateCircle already calls for name,
 * description, and cover (SECURITY DEFINER; raises if the caller isn't a
 * circle admin). No new RPC, no schema change.
 *
 * Invalidates the circle detail so the reserved tile reflects the saved state.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { circleKeys } from '../lib/circles/keys';

export function useUpdateCircleRoom(circleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (roomEnabled: boolean): Promise<void> => {
      const { error } = await supabase.rpc('update_circle', {
        p_circle_id: circleId,
        p_room_enabled: roomEnabled,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: circleKeys.detail(circleId) });
    },
  });
}
