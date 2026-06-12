/**
 * useCreateCirclePlan - create a circle-aware plan via the create_circle_plan
 * RPC (held migration 20260609140200). A circle plan is a real events row; this
 * is the only write path for it. Gated upstream by GROUPS_ENABLED.
 *
 * Returns { event_id, has_own_chat } so the caller can route straight to the
 * plan's own chat or back to the circle chat without a refetch.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { circleKeys } from '../lib/circles/keys';

export type CirclePlanVisibility = 'circle_only' | 'open';

export interface CreateCirclePlanArgs {
  circleId: string;
  title: string;
  /** ISO timestamp. */
  startTime: string;
  visibility: CirclePlanVisibility;
  /** Required (2..7) when visibility === 'open'; ignored for circle_only. */
  strangerCap?: number | null;
  /** Carries over the existing single-gender rule; defaults 'mixed'. */
  genderRule?: string | null;
  /** null/empty = the whole circle; a subset = picked members get their own chat. */
  memberUserIds?: string[] | null;
  locationText?: string | null;
  description?: string | null;
  /** Category, lowercased -> events.primary_vibe (RPC param already exists). */
  primaryVibe?: string | null;
}

export interface CreateCirclePlanResult {
  event_id: string;
  has_own_chat: boolean;
}

export function useCreateCirclePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: CreateCirclePlanArgs): Promise<CreateCirclePlanResult> => {
      const { data, error } = await supabase.rpc('create_circle_plan', {
        p_circle_id: args.circleId,
        p_title: args.title,
        p_start_time: args.startTime,
        p_visibility: args.visibility,
        p_stranger_cap: args.visibility === 'open' ? (args.strangerCap ?? 4) : null,
        p_gender_rule: args.genderRule ?? 'mixed',
        p_member_user_ids:
          args.memberUserIds && args.memberUserIds.length > 0 ? args.memberUserIds : null,
        p_location_text: args.locationText ?? null,
        p_description: args.description ?? null,
        p_primary_vibe: args.primaryVibe ?? null,
      });
      if (error) throw error;
      return data as CreateCirclePlanResult;
    },
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: circleKeys.detail(args.circleId) });
      queryClient.invalidateQueries({ queryKey: ['circle-plans', args.circleId] });
      queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
      queryClient.invalidateQueries({ queryKey: ['my-plans'] });
    },
  });
}
