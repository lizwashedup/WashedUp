import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { yoursKeys } from '../lib/yours/keys';
import { assertRpcShape, BACKLOG_KEYS } from '../lib/yours/shapeGuard';
import type { BacklogPerson } from '../lib/yours/types';
import { requestWithDeadline } from '../lib/requestWithDeadline';

/** People you've completed a plan with, not yet connected. */
export function usePlanHistoryBacklog(userId: string | null | undefined, scope?: { userId: string; epoch: number; isCurrent: () => boolean }) {
  // Reader identity prevents a remount from reusing a prior account visit.
  const reader = useId();
  return useQuery({
    queryKey: [...yoursKeys.backlog(userId ?? ''), ...(scope ? [scope.epoch, reader] : [])],
    enabled: !!userId,
    ...(scope ? { retry: false as const } : {}),
    queryFn: async ({ signal }): Promise<BacklogPerson[]> => {
      const check = () => {
        if (signal.aborted || (scope && (scope.userId !== userId || !scope.isCurrent()))) throw new Error('This plan history read is no longer current.');
      };
      check();
      if (scope) {
        const verified = await requestWithDeadline(supabase.auth.getUser(), 12_000);
        check();
        if (verified.error) throw verified.error;
        if (verified.data.user?.id !== userId) throw new Error('This account changed.');
      }
      const request = supabase.rpc('get_plan_history_backlog', { p_user_id: userId });
      const { data, error } = await requestWithDeadline(scope ? Promise.resolve(request.abortSignal(signal)) : request, 12_000);
      check();
      if (error) throw error;
      if (!Array.isArray(data) || data.some(row => !row || typeof row !== 'object'
        || typeof row.user_id !== 'string' || !row.user_id)) {
        throw new Error('Could not load people from your plans. Please try again.');
      }
      return assertRpcShape<BacklogPerson>(data, BACKLOG_KEYS, 'get_plan_history_backlog');
    },
  });
}
