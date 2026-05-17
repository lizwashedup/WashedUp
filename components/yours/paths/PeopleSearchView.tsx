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
import { usePeopleSearch } from '../../../hooks/usePeopleSearch';
import {
  usePeopleConnectionMutations,
  friendlyConnectionError,
} from '../../../hooks/usePeopleConnectionMutations';
import type { SearchPerson } from '../../../lib/yours/types';

/** Search all WashedUp users by name or handle. */
export default function PeopleSearchView({
  userId,
  onPressPerson,
}: {
  userId: string;
  onPressPerson: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const { data, isFetching } = usePeopleSearch(userId, q);
  const { sendRequest } = usePeopleConnectionMutations(userId);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const add = async (p: SearchPerson) => {
    setPending((s) => new Set(s).add(p.user_id));
    try {
      await sendRequest.mutateAsync({
        recipientId: p.user_id,
        context: 'search',
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
          placeholder="Search by name or @handle"
          placeholderTextColor={Colors.tertiary}
          autoCapitalize="none"
          autoFocus
          style={styles.input}
        />
        {isFetching && <ActivityIndicator color={Colors.tertiary} />}
      </View>
      <FlatList
        data={data ?? []}
        keyExtractor={(p) => p.user_id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <PersonRow
            name={item.first_name_display}
            photoUrl={item.profile_photo_url}
            sharedCount={item.shared_count}
            state={
              pending.has(item.user_id)
                ? 'requested'
                : item.connection_state === 'incoming'
                  ? 'none'
                  : item.connection_state
            }
            onAdd={() => add(item)}
            onPressPerson={() => onPressPerson(item.user_id)}
          />
        )}
        ListEmptyComponent={
          q.trim().length >= 2 && !isFetching ? (
            <Text style={styles.empty}>No one by that name.</Text>
          ) : null
        }
      />
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
