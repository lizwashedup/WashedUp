import React, { useState } from 'react';
import {
  View,
  TextInput,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Text,
  Alert,
} from 'react-native';
import { Search } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import PersonRow from './PersonRow';
import { usePlanHistoryBacklog } from '../../../hooks/usePlanHistoryBacklog';
import {
  usePeopleConnectionMutations,
  friendlyConnectionError,
} from '../../../hooks/usePeopleConnectionMutations';
import type { BacklogPerson } from '../../../lib/yours/types';

/** Full list of people you've completed a plan with. Searchable locally. */
export default function PlanHistoryBacklog({
  userId,
  onPressPerson,
}: {
  userId: string;
  onPressPerson: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const { data, isLoading } = usePlanHistoryBacklog(userId);
  const { sendRequest } = usePeopleConnectionMutations(userId);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const list = (data ?? []).filter((p) =>
    (p.first_name_display ?? '')
      .toLowerCase()
      .includes(q.trim().toLowerCase()),
  );

  const add = async (p: BacklogPerson) => {
    setPending((s) => new Set(s).add(p.user_id));
    try {
      await sendRequest.mutateAsync({
        recipientId: p.user_id,
        context: 'plan_history',
      });
    } catch (e) {
      Alert.alert('', friendlyConnectionError(e));
      setPending((s) => {
        const n = new Set(s);
        n.delete(p.user_id);
        return n;
      });
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.searchBox}>
        <Search size={18} color={Colors.tertiary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search"
          placeholderTextColor={Colors.tertiary}
          style={styles.input}
        />
      </View>
      {isLoading ? (
        <ActivityIndicator color={Colors.terracotta} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(p) => p.user_id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <PersonRow
              name={item.first_name_display}
              photoUrl={item.profile_photo_url}
              sharedCount={item.shared_count}
              state={
                pending.has(item.user_id) || item.state === 'requested'
                  ? 'requested'
                  : 'none'
              }
              onAdd={() => add(item)}
              onPressPerson={() => onPressPerson(item.user_id)}
            />
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No one here yet. Go do a plan, then come back.
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  empty: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginTop: 32,
  },
});
