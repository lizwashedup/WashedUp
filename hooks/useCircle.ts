/**
 * useCircle - one circle's noticeboard payload for the circle home.
 *
 * Wraps `get_circle(p_circle_id)` (SECURITY DEFINER; raises if the caller is
 * not a joined member). Returns jsonb, so the payload arrives already parsed.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { circleKeys } from '../lib/circles/keys';
import type { CirclePayload } from '../lib/circles/types';

export function useCircle(circleId: string | null | undefined) {
  return useQuery({
    queryKey: circleKeys.detail(circleId ?? ''),
    enabled: !!circleId,
    // Keep a recently-viewed circle's payload warm so re-opening the chat (or
    // bouncing to the detail page and back) renders the name instantly instead
    // of flashing the "..." placeholder + firing a redundant get_circle.
    staleTime: 60_000,
    queryFn: async (): Promise<CirclePayload> => {
      const { data, error } = await supabase.rpc('get_circle', {
        p_circle_id: circleId,
      });
      if (error) throw error;
      return data as CirclePayload;
    },
  });
}
