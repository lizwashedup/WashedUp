import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { yoursKeys } from '../lib/yours/keys';
import { assertRpcShape, PROFILE_CARD_KEYS } from '../lib/yours/shapeGuard';
import type { ProfileCard } from '../lib/yours/types';

export interface ProfileCardScope { userId: string; epoch: number; isCurrent(): boolean }

/** Full profile card if connected, otherwise the minimal view. */
export function useProfileCard(
  userId: string | null | undefined,
  targetId: string | null | undefined,
  scope?: ProfileCardScope,
) {
  // An observer's epoch is local to its mount. Include this reader as well so
  // reopening a private preview cannot reuse an earlier observer's epoch/cache.
  const reader = useId();
  return useQuery({
    queryKey: [...yoursKeys.profileCard(userId ?? '', targetId ?? ''), ...(scope ? [scope.epoch, reader] : [])],
    enabled: !!userId && !!targetId,
    retry: false,
    queryFn: async ({ signal }): Promise<ProfileCard | null> => {
      const check = () => {
        if (signal.aborted || (scope && (scope.userId !== userId || !scope.isCurrent()))) throw new Error('This profile request is no longer current.');
      };
      check();
      if (scope) {
        const verified = await requestWithDeadline(supabase.auth.getUser(), 12_000);
        check();
        if (verified.error) throw verified.error;
        if (verified.data.user?.id !== userId) throw new Error('This account changed.');
      }
      const request = supabase.rpc('get_profile_card', {
        p_user_id: userId,
        p_target: targetId,
      });
      // Keep React Query's cancellation signal on the scoped request; the
      // deadline bounds its result without replacing that transport signal.
      const { data, error } = await requestWithDeadline(scope ? Promise.resolve(request.abortSignal(signal)) : request, 12_000);
      check();
      if (error) throw error;
      const rows = assertRpcShape<ProfileCard>(data, PROFILE_CARD_KEYS, 'get_profile_card');
      const card = rows[0] ?? null; // empty => blocked / not visible
      if (card && (card.user_id !== targetId || !['full', 'minimal'].includes(card.kind))) throw new Error('Could not confirm this profile. Please try again.');
      return card;
    },
  });
}
