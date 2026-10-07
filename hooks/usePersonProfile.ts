import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { yoursKeys } from '../lib/yours/keys';
import type { PersonProfile } from '../lib/yours/types';

export interface PersonProfileScope {
  userId: string;
  epoch: number;
  isCurrent: () => boolean;
}

/**
 * The gated individual-profile payload ("just {name}"). The viewer is the
 * authed user (the RPC reads auth.uid()), so only the target id is passed.
 *
 * get_person_profile returns a single jsonb object, or NULL when the viewer
 * and target are not MUTUAL (or are blocked); there is no client-side gate,
 * the privacy rule lives in the database. A null result drives the page's
 * quiet not-found state. userId is in the query key only to scope the cache to
 * the signed-in account (it is not sent to the RPC).
 */
export function usePersonProfile(
  userId: string | null | undefined,
  targetId: string | null | undefined,
  scope?: PersonProfileScope,
) {
  return useQuery({
    queryKey: [...yoursKeys.personProfile(userId ?? '', targetId ?? ''), ...(scope ? [scope.epoch] : [])],
    enabled: !!userId && !!targetId,
    queryFn: async ({ signal }): Promise<PersonProfile | null> => {
      const check = () => {
        if (signal.aborted || (scope && (scope.userId !== userId || !scope.isCurrent()))) {
          throw new Error('This profile request is no longer current.');
        }
      };
      check();
      if (scope) {
        const verified = await supabase.auth.getUser();
        check();
        if (verified.error) throw verified.error;
        if (verified.data.user?.id !== scope.userId) throw new Error('This account changed. Please try again.');
      }
      check();
      const request = supabase.rpc('get_person_profile', {
        p_target: targetId,
      });
      const { data, error } = await (scope ? request.abortSignal(signal) : request);
      check();
      if (error) throw error;
      // Null is the same private unavailable result for denied and nonexistent.
      // A mismatched/malformed response must never expose another person's data.
      if (data != null && (typeof data !== 'object' || Array.isArray(data) || data.user_id !== targetId)) {
        throw new Error('Could not confirm this profile. Please try again.');
      }
      return (data as PersonProfile | null) ?? null;
    },
  });
}
