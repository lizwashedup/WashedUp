import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { yoursKeys } from '../lib/yours/keys';
import type { PersonProfile } from '../lib/yours/types';

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
) {
  return useQuery({
    queryKey: yoursKeys.personProfile(userId ?? '', targetId ?? ''),
    enabled: !!userId && !!targetId,
    queryFn: async (): Promise<PersonProfile | null> => {
      const { data, error } = await supabase.rpc('get_person_profile', {
        p_target: targetId,
      });
      if (error) throw error;
      // Single object or null (non-mutual / blocked). Not a SETOF, so no
      // assertRpcShape here (that helper expects an array of rows).
      return (data as PersonProfile | null) ?? null;
    },
  });
}
