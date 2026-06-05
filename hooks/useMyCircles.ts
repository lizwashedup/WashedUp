/**
 * useMyCircles — the caller's joined circles for the Yours > Circles directory.
 *
 * Wraps the `get_my_circles()` RPC (SECURITY DEFINER, authorizes on auth.uid()).
 * The RPC takes no params; userId is passed only to gate `enabled` and key the
 * cache. Returns jsonb, so the payload arrives already parsed as MyCircle[].
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { circleKeys } from '../lib/circles/keys';
import type { MyCircle } from '../lib/circles/types';

export function useMyCircles(userId: string | null | undefined) {
  return useQuery({
    queryKey: circleKeys.mine(userId ?? ''),
    enabled: !!userId,
    queryFn: async (): Promise<MyCircle[]> => {
      const { data, error } = await supabase.rpc('get_my_circles');
      if (error) throw error;
      return (data ?? []) as MyCircle[];
    },
  });
}
