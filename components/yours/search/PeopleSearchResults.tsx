import React, { useMemo } from 'react';
import { View, Text, ScrollView, Alert, StyleSheet } from 'react-native';
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

  if (local.length === 0 && remote.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{COPY.searchNoResults}</Text>
        <Text style={styles.emptySub}>{COPY.searchNoResultsSub}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
    >
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
              state={r.connection_state}
              onAdd={async () => {
                try {
                  await sendRequest.mutateAsync({
                    recipientId: r.user_id,
                    context: 'handle_lookup',
                  });
                } catch (e) {
                  Alert.alert('', friendlyConnectionError(e));
                }
              }}
              onPressPerson={() => onOpenMinimal(r.user_id)}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },
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
