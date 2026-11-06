/**
 * Circle-plan coordination actions (held migration 20260609140100):
 *   useReleaseCirclePlan - "Open it up" (release_circle_plan): flips a
 *                        circle_only plan to open, sets the stranger cap, and
 *                        spawns its chat.
 * Invalidates the plan-context + plan-detail queries so the screen updates.
 * Gated upstream by GROUPS_ENABLED.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

function useInvalidatePlan(eventId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['circle-plan-context', eventId] });
    queryClient.invalidateQueries({ queryKey: ['events', 'detail', eventId] });
    queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
  };
}

export function useReleaseCirclePlan(eventId: string) {
  const invalidate = useInvalidatePlan(eventId);
  return useMutation({
    mutationFn: async (strangerCap: number = 4) => {
      const { error } = await supabase.rpc('release_circle_plan', {
        p_event_id: eventId,
        p_stranger_cap: strangerCap,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
