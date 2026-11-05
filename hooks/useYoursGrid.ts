import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { yoursKeys } from '../lib/yours/keys';
import { assertRpcShape, YOURS_GRID_KEYS } from '../lib/yours/shapeGuard';
import type { YoursGridPerson } from '../lib/yours/types';

/** Accepted people, with activity ring, milestone, upcoming-plan pill. */
export function useYoursGrid(userId: string | null | undefined, scope?: { userId: string; epoch: number; isCurrent: () => boolean }) {
  // Observer epochs restart on remount; keep private reader caches distinct.
  // Existing connection mutations still invalidate the grid-key prefix.
  const reader = useId();
  return useQuery({
    queryKey: [...yoursKeys.grid(userId ?? ''), ...(scope ? [scope.epoch, reader] : [])],
    enabled: !!userId,
    ...(scope ? { retry: false as const } : {}),
    queryFn: async ({ signal }): Promise<YoursGridPerson[]> => {
      const check = () => {
        if (signal.aborted || (scope && (scope.userId !== userId || !scope.isCurrent()))) throw new Error('This People request is no longer current.');
      };
      check();
      if (scope) {
        const verified = await requestWithDeadline(supabase.auth.getUser(), 12_000);
        check();
        if (verified.error) throw verified.error;
        if (verified.data.user?.id !== userId) throw new Error('This account changed.');
      }
      const request = supabase.rpc('get_yours_grid', {
        p_user_id: userId,
      });
      const { data, error } = await requestWithDeadline(Promise.resolve(scope ? request.abortSignal(signal) : request), 12_000);
      check();
      if (error) throw error;
      if (!Array.isArray(data) || data.some(row => !row || typeof row !== 'object'
        || typeof row.user_id !== 'string' || !row.user_id)) {
        throw new Error('Could not load your people. Please try again.');
      }
      return assertRpcShape<YoursGridPerson>(data, YOURS_GRID_KEYS, 'get_yours_grid');
    },
  });
}
