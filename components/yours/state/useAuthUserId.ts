import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

/** Current authenticated user id, matching the legacy screen's pattern. */
export function useAuthUserId() {
  return useQuery({
    queryKey: ['auth-user-id'],
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
    staleTime: Infinity,
  });
}
