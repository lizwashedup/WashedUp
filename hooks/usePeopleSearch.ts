import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { yoursKeys } from '../lib/yours/keys';
import type { SearchPerson } from '../lib/yours/types';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

/**
 * Debounced name/handle search across all WashedUp users. Mirrors the
 * legacy friends-screen debounce: only queries at >= 2 chars.
 */
export function usePeopleSearch(
  userId: string | null | undefined,
  rawQuery: string,
) {
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(rawQuery.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [rawQuery]);

  return useQuery({
    queryKey: yoursKeys.search(userId ?? '', debounced),
    enabled: !!userId && debounced.length >= MIN_QUERY_LEN,
    queryFn: async (): Promise<SearchPerson[]> => {
      const { data, error } = await supabase.rpc('search_people', {
        p_user_id: userId,
        p_query: debounced,
      });
      if (error) throw error;
      return (data ?? []) as SearchPerson[];
    },
  });
}
