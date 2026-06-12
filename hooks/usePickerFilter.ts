/**
 * usePickerFilter - local search for an already-loaded "your people" picker list.
 *
 * One shared hook so the behavior never drifts between the pickers (the circle
 * creation "who's in it" step, AddPeopleSheet, the composer's PeoplePickerSheet),
 * per circle-identity-design-spec.md 1b: a search field appears only once the
 * pickable list passes the threshold, filters on first name + handle, and keeps
 * already-selected people visible even when they fall outside the current query.
 *
 * This is a CLIENT-side filter of a loaded list, distinct from usePeopleSearch
 * (the server-side exact @handle lookup for adding strangers).
 */
import { useMemo, useState } from 'react';

export const PICKER_SEARCH_THRESHOLD = 10;

interface Searchable {
  first_name_display: string | null;
  handle: string | null;
}

export function usePickerFilter<T extends Searchable>(
  people: T[],
  keepVisible?: (person: T) => boolean,
) {
  const [query, setQuery] = useState('');
  const showSearch = people.length > PICKER_SEARCH_THRESHOLD;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@+/, '');
    if (!q) return people;
    return people.filter((p) => {
      const name = (p.first_name_display ?? '').toLowerCase();
      const handle = (p.handle ?? '').toLowerCase().replace(/^@+/, '');
      return name.includes(q) || handle.includes(q) || keepVisible?.(p) === true;
    });
  }, [people, query, keepVisible]);

  return {
    // Never carry a stale query while the field is hidden (small lists).
    query: showSearch ? query : '',
    setQuery,
    showSearch,
    filtered,
  };
}
