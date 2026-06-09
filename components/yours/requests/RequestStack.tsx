import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
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
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [blockFor, setBlockFor] = useState<IncomingRequest | null>(null);
  const { accept, decline } = usePeopleConnectionMutations(userId);

  // Work off a filtered queue, not a fixed index: resolving a request
  // invalidates the incoming-requests query, so the `requests` prop shrinks
  // underneath us. An index would then skip the next card (it slid into the
  // just-resolved slot). Taking the first request whose connection_id we
  // haven't resolved is stable across refetches.
  const card = resolved.size
    ? requests.find((r) => !resolved.has(r.connection_id)) ?? null
    : requests[0] ?? null;

  const markResolved = (id: string) =>
    setResolved((prev) => new Set(prev).add(id));
  const unresolve = (id: string) =>
    setResolved((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  // Close once nothing is left to act on and no block prompt is open.
  useEffect(() => {
    if (!card && !blockFor) {
      const t = setTimeout(onClose, 600);
      return () => clearTimeout(t);
    }
  }, [card, blockFor, onClose]);

  const onAdd = (r: IncomingRequest) => {
    if (resolved.has(r.connection_id)) return; // sync guard vs rapid double-tap
    markResolved(r.connection_id);
    accept.mutateAsync(r.requester_user_id).catch((e) => {
      unresolve(r.connection_id);
      Alert.alert('', friendlyConnectionError(e));
    });
  };

  // "Not now" is a SOFT decline (can_re_request stays true via the RPC): it
  // commits immediately, then offers the optional Block escalation. The block
  // prompt's auto-dismiss and "No, I'm good" commit nothing extra; only the
  // explicit "Block" button escalates to a permanent, blocked decline.
  const onNotNow = (r: IncomingRequest) => {
    if (resolved.has(r.connection_id)) return; // sync guard vs rapid double-tap
    markResolved(r.connection_id);
    decline
      .mutateAsync({ requesterId: r.requester_user_id, block: false })
      .catch(() => {});
    setBlockFor(r);
  };
  const onBlock = (r: IncomingRequest) => {
    decline
      .mutateAsync({ requesterId: r.requester_user_id, block: true })
      .catch(() => {});
    setBlockFor(null);
  };
  const dismissBlockPrompt = () => setBlockFor(null);

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
          {blockFor ? (
            <BlockPrompt
              name={blockFor.first_name_display ?? 'them'}
              onBlock={() => onBlock(blockFor)}
              onKeep={dismissBlockPrompt}
            />
          ) : card ? (
            <SwipeableRequestCard
              key={card.connection_id}
              req={card}
              onAdd={() => onAdd(card)}
              onNotNow={() => onNotNow(card)}
            />
          ) : (
            <Text style={styles.done}>You're all caught up.</Text>
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
