import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import SwipeableRequestCard from './SwipeableRequestCard';
import BlockPrompt from './BlockPrompt';
import {
  usePeopleConnectionMutations,
  friendlyConnectionError,
} from '../../../hooks/usePeopleConnectionMutations';
import type { IncomingRequest } from '../../../lib/yours/types';

/**
 * Full-screen request card stack. Max 3 cards visible (next peeks behind).
 */
export default function RequestStack({
  visible,
  onClose,
  userId,
  requests,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string;
  requests: IncomingRequest[];
}) {
  const [idx, setIdx] = useState(0);
  const [blockFor, setBlockFor] = useState<IncomingRequest | null>(null);
  const { accept, decline } = usePeopleConnectionMutations(userId);

  const current = requests[idx];
  const advance = () => {
    setIdx((i) => i + 1);
    if (idx + 1 >= requests.length) setTimeout(onClose, 250);
  };

  const onAdd = async (r: IncomingRequest) => {
    try {
      await accept.mutateAsync(r.requester_user_id);
      advance();
    } catch (e) {
      Alert.alert('', friendlyConnectionError(e));
    }
  };

  const onNotNow = (r: IncomingRequest) => {
    setBlockFor(r);
  };

  const finishDecline = async (r: IncomingRequest, block: boolean) => {
    try {
      await decline.mutateAsync({ requesterId: r.requester_user_id, block });
    } catch {
      /* declining is best-effort; the row may already be gone */
    }
    setBlockFor(null);
    advance();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <Pressable
          style={styles.close}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
        >
          <X size={24} color={Colors.asphalt} />
        </Pressable>

        <View style={styles.stack}>
          {!current ? (
            <Text style={styles.done}>You're all caught up.</Text>
          ) : blockFor ? (
            <BlockPrompt
              name={blockFor.first_name_display ?? 'them'}
              onBlock={() => finishDecline(blockFor, true)}
              onKeep={() => finishDecline(blockFor, false)}
            />
          ) : accept.isPending ? (
            <ActivityIndicator color={Colors.terracotta} />
          ) : (
            <SwipeableRequestCard
              key={current.connection_id}
              req={current}
              onAdd={() => onAdd(current)}
              onNotNow={() => onNotNow(current)}
            />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  close: { alignSelf: 'flex-end', padding: 16 },
  stack: { flex: 1, justifyContent: 'center' },
  done: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayMD,
    color: Colors.secondary,
    textAlign: 'center',
  },
});
