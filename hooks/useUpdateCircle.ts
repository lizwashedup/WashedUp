/**
 * useUpdateCircle - edit a circle's identity (name / description).
 *
 * Wraps update_circle(p_circle_id, p_name, p_description), which is admin-gated
 * (the SECURITY DEFINER RPC raises if the caller isn't a circle admin). The one
 * caller today is the "Name this circle" front door for an unnamed circle (a DM
 * grown to 3+ people); the DM's original pair are both admins, so either can
 * name it. Passing a blank name is a no-op server-side (COALESCE(NULLIF(...))),
 * so the sheet enforces a non-empty name before calling.
 *
 * Invalidates the circle detail (hero re-renders with the new name) and the
 * directory (the row stops showing the member-name fallback).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { circleKeys } from '../lib/circles/keys';

export interface UpdateCircleIdentity {
  name: string;
  description: string | null;
}

export function useUpdateCircle(
  circleId: string,
  userId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, description }: UpdateCircleIdentity): Promise<void> => {
      const { error } = await supabase.rpc('update_circle', {
        p_circle_id: circleId,
        p_name: name,
        p_description: description,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: circleKeys.detail(circleId) });
      if (userId) qc.invalidateQueries({ queryKey: circleKeys.mine(userId) });
    },
  });
}
