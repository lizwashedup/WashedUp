import React, { useState } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Text,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { AtSign } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import PersonRow from './PersonRow';
import { usePeopleSearch } from '../../../hooks/usePeopleSearch';
import {
  usePeopleConnectionMutations,
  friendlyConnectionError,
} from '../../../hooks/usePeopleConnectionMutations';
import type { SearchPerson } from '../../../lib/yours/types';
import { COPY } from '../state/constants';

/**
 * Exact @handle lookup. WashedUp never surfaces strangers: you type someone's
 * exact handle and it either resolves to that one person or to nothing. No
 * list, no fuzzy matching, no suggestions, no "did you mean", no directory.
 */
export default function HandleLookupView({
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

  const match: SearchPerson | undefined = data?.[0];

  const add = async (p: SearchPerson) => {
    setPending((s) => new Set(s).add(p.user_id));
    try {
      await sendRequest.mutateAsync({
        recipientId: p.user_id,
        context: 'handle_lookup',
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
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inputBox}>
        <AtSign size={18} color={Colors.tertiary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Enter an exact handle"
          placeholderTextColor={Colors.tertiary}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="search"
          accessibilityLabel="Find someone by their exact handle"
          style={styles.input}
        />
        {isFetching && <ActivityIndicator color={Colors.tertiary} />}
      </View>

      {match ? (
        <PersonRow
          name={match.first_name_display}
          photoUrl={match.profile_photo_url}
          sharedCount={match.shared_count}
          state={
            pending.has(match.user_id)
              ? 'requested'
              : match.connection_state === 'incoming'
                ? 'none'
                : match.connection_state
          }
          onAdd={() => add(match)}
          onPressPerson={() => onPressPerson(match.user_id)}
        />
      ) : null}

      <Text style={styles.hint}>
        {!isFetching && data?.length === 0
          ? COPY.handleLookupEmpty
          : 'You can only add people you already know. Type a handle exactly.'}
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  inputBox: {
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
  hint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    marginTop: 16,
    paddingHorizontal: 4,
  },
});
