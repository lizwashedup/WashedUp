import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { yoursKeys } from '../lib/yours/keys';
import { assertRpcShape, SEARCH_PERSON_KEYS } from '../lib/yours/shapeGuard';
import type { SearchPerson } from '../lib/yours/types';

const DEBOUNCE_MS = 300;
const MIN_HANDLE_LEN = 2;

/** Strip a leading @, trim, lowercase. Handles are case-insensitive. */
function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * Exact @handle lookup. WashedUp never surfaces strangers: there is no name
 * search, no fuzzy matching, no directory. This resolves at most one person
 * whose handle exactly matches what was typed (the search_people RPC enforces
 * the exact match server-side; this hook just normalizes + debounces input).
 */
export function usePeopleSearch(
  userId: string | null | undefined,
  rawQuery: string,
) {
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(
      () => setDebounced(normalizeHandle(rawQuery)),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(t);
  }, [rawQuery]);

  return useQuery({
    queryKey: yoursKeys.handleLookup(userId ?? '', debounced),
    enabled: !!userId && debounced.length >= MIN_HANDLE_LEN,
    queryFn: async (): Promise<SearchPerson[]> => {
      const { data, error } = await supabase.rpc('search_people', {
        p_user_id: userId,
        p_query: debounced,
      });
      if (error) throw error;
      return assertRpcShape<SearchPerson>(data, SEARCH_PERSON_KEYS, 'search_people');
    },
  });
}
