import React, { useMemo } from 'react';
import { View, Text, Alert, StyleSheet } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { COPY } from '../state/constants';
import PersonRow from '../paths/PersonRow';
import { usePeopleSearch } from '../../../hooks/usePeopleSearch';
import {
  usePeopleConnectionMutations,
  friendlyConnectionError,
} from '../../../hooks/usePeopleConnectionMutations';
import type { YoursGridPerson } from '../../../lib/yours/types';

/**
 * Results for the People hub search. Two intents in one field:
 *   - filter the people you already have (local, tap opens the keep page)
 *   - resolve an exact handle for someone new (remote search_people, tap
 *     opens the minimal profile so you can add them)
 * Strangers are never surfaced by name; the remote half is exact-handle
 * only (enforced server-side by search_people).
 *
 * Renders a plain View (no own ScrollView): it mounts INLINE inside
 * PeopleScreen's always-mounted ScrollView, which owns scrolling; that is
 * what keeps the search TextInput mounted (and focused) across the
 * browse <-> search flip. Result sets are small (your people + exact-handle
 * matches), so no virtualization is needed.
 */
export default function PeopleSearchResults({
  userId,
  query,
  people,
  onOpenPerson,
  onOpenMinimal,
}: {
  userId: string;
  query: string;
  people: YoursGridPerson[];
  onOpenPerson: (id: string) => void;
  onOpenMinimal: (id: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const handleQuery = q.replace(/^@+/, '');

  const local = useMemo(
    () =>
      people.filter((p) => {
        const n = (p.first_name_display ?? '').toLowerCase();
        const h = (p.handle ?? '').toLowerCase();
        return n.includes(q) || (!!handleQuery && h.includes(handleQuery));
      }),
    [people, q, handleQuery],
  );

  const { data: remoteRaw = [] } = usePeopleSearch(userId, query);
  const localIds = useMemo(
    () => new Set(people.map((p) => p.user_id)),
    [people],
  );
  const remote = remoteRaw.filter((r) => !localIds.has(r.user_id));

  const { sendRequest } = usePeopleConnectionMutations(userId);

  // Optimistic add: flip the row to "Requested" the instant Add is tapped, before
  // the request round-trips (parent-managed, same pattern as PlanHistoryBacklog).
  // Roll back on error; a successful refetch sets the real connection_state.
  const [requested, setRequested] = React.useState<Set<string>>(new Set());
  const handleAdd = React.useCallback(
    async (recipientId: string) => {
      setRequested((s) => new Set(s).add(recipientId));
      try {
        await sendRequest.mutateAsync({ recipientId, context: 'handle_lookup' });
      } catch (e) {
        setRequested((s) => {
          const n = new Set(s);
          n.delete(recipientId);
          return n;
        });
        Alert.alert('', friendlyConnectionError(e));
      }
    },
    [sendRequest],
  );

  if (local.length === 0 && remote.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{COPY.searchNoResults}</Text>
        <Text style={styles.emptySub}>{COPY.searchNoResultsSub}</Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {local.length > 0 && (
        <>
          <Text style={styles.section}>{COPY.searchYoursSection}</Text>
          {local.map((p) => (
            <PersonRow
              key={p.user_id}
              name={p.first_name_display}
              photoUrl={p.profile_photo_url}
              sharedCount={p.shared_count}
              state="connected"
              onAdd={() => {}}
              onPressPerson={() => onOpenPerson(p.user_id)}
            />
          ))}
        </>
      )}

      {remote.length > 0 && (
        <>
          <Text style={styles.section}>{COPY.searchNewSection}</Text>
          {remote.map((r) => (
            <PersonRow
              key={r.user_id}
              name={r.first_name_display}
              photoUrl={r.profile_photo_url}
              sharedCount={r.shared_count}
              state={
                requested.has(r.user_id) || r.connection_state === 'requested'
                  ? 'requested'
                  : r.connection_state
              }
              onAdd={() => handleAdd(r.user_id)}
              onPressPerson={() => onOpenMinimal(r.user_id)}
            />
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  section: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 4,
  },
  empty: { paddingHorizontal: 32, paddingTop: 40, alignItems: 'center' },
  emptyTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
    textAlign: 'center',
  },
  emptySub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 4,
    textAlign: 'center',
  },
});
