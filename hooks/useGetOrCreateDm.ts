/**
 * useGetOrCreateDm - open (or create) the 1:1 DM with another person.
 *
 * Wraps get_or_create_dm(p_other) -> circle id. A DM is an unnamed 2-person
 * circle, so the returned id routes to the same circle chat as everything else
 * (/(tabs)/chats/circle/[id]), where it renders as the counterpart (see
 * lib/circles/display). The RPC block-checks server-side, so a blocked pair
 * surfaces as an error the caller can show.
 */
import { useMutation } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useGetOrCreateDm() {
  return useMutation({
    mutationFn: async (otherUserId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('get_or_create_dm', {
        p_other: otherUserId,
      });
      if (error) throw error;
      return data as string;
    },
  });
}
