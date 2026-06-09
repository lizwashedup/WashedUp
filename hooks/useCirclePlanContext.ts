/**
 * useCirclePlanContext - one read (get_circle_plan_context, held migration
 * 20260609140100) the plan-detail screen makes to decide:
 *   - whether this plan is a circle plan at all,
 *   - which join path to use (member/stranger -> join_circle_plan_atomic),
 *   - whether to skip the required-greeting modal (members bypass the intro),
 *   - and how many stranger spots are left.
 *
 * Returns is_circle_plan=false for a normal plan, so callers can treat the
 * absence of circle context as "behave exactly as before".
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface CirclePlanContext {
  is_circle_plan: boolean;
  circle_id?: string | null;
  circle_name?: string | null;
  circle_visibility?: 'circle_only' | 'open' | null;
  stranger_cap?: number | null;
  has_own_chat?: boolean;
  viewer_is_member?: boolean;
  viewer_stranger_spots_left?: number | null;
}

export function useCirclePlanContext(eventId: string | null | undefined) {
  return useQuery({
    queryKey: ['circle-plan-context', eventId ?? ''],
    enabled: !!eventId,
    staleTime: 30_000,
    queryFn: async (): Promise<CirclePlanContext> => {
      const { data, error } = await supabase.rpc('get_circle_plan_context', {
        p_event_id: eventId,
      });
      // If the RPC isn't deployed yet (held migration), degrade to "normal plan"
      // so the detail screen behaves exactly as it does today.
      if (error) {
        if (error.message?.includes('does not exist') || (error as any).code === '42883') {
          return { is_circle_plan: false };
        }
        throw error;
      }
      return (data as CirclePlanContext) ?? { is_circle_plan: false };
    },
  });
}
