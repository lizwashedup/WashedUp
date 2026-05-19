import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { yoursKeys } from '../lib/yours/keys';
import { assertRpcShape, PROFILE_CARD_KEYS } from '../lib/yours/shapeGuard';
import type { ProfileCard } from '../lib/yours/types';

/** Full profile card if connected, otherwise the minimal view. */
export function useProfileCard(
  userId: string | null | undefined,
  targetId: string | null | undefined,
) {
  return useQuery({
    queryKey: yoursKeys.profileCard(userId ?? '', targetId ?? ''),
    enabled: !!userId && !!targetId,
    queryFn: async (): Promise<ProfileCard | null> => {
      const { data, error } = await supabase.rpc('get_profile_card', {
        p_user_id: userId,
        p_target: targetId,
      });
      if (error) throw error;
      const rows = assertRpcShape<ProfileCard>(data, PROFILE_CARD_KEYS, 'get_profile_card');
      return rows[0] ?? null; // empty => blocked / not visible
    },
  });
}
