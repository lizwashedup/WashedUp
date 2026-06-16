import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { X } from 'lucide-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import RequestRow from './RequestRow';
import BlockPrompt from './BlockPrompt';
import { COPY } from '../state/constants';
import {
  usePeopleConnectionMutations,
  friendlyConnectionError,
} from '../../../hooks/usePeopleConnectionMutations';
import type { IncomingRequest } from '../../../lib/yours/types';

/**
 * Pending-request surface. Renders EVERY pending request as an explicit list
 * row, never a single auto-advancing card. Opening this surface (from a
 * notification, the banner, or the inbox) acts on nothing: no accept, no
 * decline, no auto-target. Accept and decline are per-row buttons that affect
 * only that person (the RPC is keyed by requester id). `highlightRequesterId`
 * (carried from a notification tap) floats the tapped person to the top with a
 * gold ring so the right request is front-and-centre.
 */
export default function RequestStack({
  visible,
  onClose,
  userId,
  requests,
  highlightRequesterId,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string;
  requests: IncomingRequest[];
  highlightRequesterId?: string | null;
}) {
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [blockFor, setBlockFor] = useState<IncomingRequest | null>(null);
  const { accept, decline } = usePeopleConnectionMutations(userId);

  // Work off a filtered queue, not indices: resolving a request invalidates
  // the incoming-requests query so `requests` shrinks underneath us.
  const pending = useMemo(() => {
    const live = requests.filter((r) => !resolved.has(r.connection_id));
    if (!highlightRequesterId) return live;
    // Float the notification's target to the top; stable order otherwise.
    return [...live].sort((a, b) => {
      const aHit = a.requester_user_id === highlightRequesterId ? 0 : 1;
      const bHit = b.requester_user_id === highlightRequesterId ? 0 : 1;
      return aHit - bHit;
    });
  }, [requests, resolved, highlightRequesterId]);

  const markResolved = (id: string) =>
    setResolved((prev) => new Set(prev).add(id));
  const unresolve = (id: string) =>
    setResolved((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  // Auto-close once nothing is left to act on and no block prompt is open.
  // This only CLOSES the surface; it never accepts or declines anything.
  // onClose is an inline arrow from the parent (new identity every render), so
  // ref it - otherwise the parent's re-renders would clear+re-arm this timer.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (pending.length === 0 && !blockFor) {
      const t = setTimeout(() => onCloseRef.current(), 600);
      return () => clearTimeout(t);
    }
  }, [pending.length, blockFor]);

  // Accept ONLY this person. RPC accepts the row keyed by requester id.
  const onAdd = (r: IncomingRequest) => {
    if (resolved.has(r.connection_id)) return; // guard vs rapid double-tap
    markResolved(r.connection_id);
    accept.mutateAsync(r.requester_user_id).catch((e) => {
      unresolve(r.connection_id);
      Alert.alert('', friendlyConnectionError(e));
    });
  };

  // Decline is already confirm-gated in the row. This commits the SOFT decline
  // (can_re_request stays true), then offers the optional Block escalation.
  const onDecline = (r: IncomingRequest) => {
    if (resolved.has(r.connection_id)) return;
    markResolved(r.connection_id);
    setBlockFor(r);
    decline
      .mutateAsync({ requesterId: r.requester_user_id, block: false })
      .catch((e) => {
        unresolve(r.connection_id);
        setBlockFor(null);
        Alert.alert('', friendlyConnectionError(e));
      });
  };

  // Escalate to a permanent blocked decline. Surface a failure instead of
  // swallowing it, so the user never believes a still-unblocked person is gone.
  const onBlock = (r: IncomingRequest) => {
    decline
      .mutateAsync({ requesterId: r.requester_user_id, block: true })
      .catch((e) => Alert.alert('', friendlyConnectionError(e)));
    setBlockFor(null);
  };
  const dismissBlockPrompt = () => setBlockFor(null);

  return (
    // statusBarTranslucent + an in-Modal SafeAreaProvider so SafeAreaView gets
    // real insets: a bare SafeAreaView inside a RN Modal measures zero (the
    // Modal renders in its own root, outside the app's SafeAreaProvider), which
    // pinned the header under the status bar. Mirrors PostPlanSurveyV3.
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <View style={styles.header}>
          <Text style={styles.title}>{COPY.requestListTitle}</Text>
          <Pressable
            style={styles.close}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
          >
            <X size={24} color={Colors.asphalt} />
          </Pressable>
        </View>

        {blockFor ? (
          <View style={styles.blockWrap}>
            <BlockPrompt
              name={blockFor.first_name_display ?? 'them'}
              onBlock={() => onBlock(blockFor)}
              onKeep={dismissBlockPrompt}
            />
          </View>
        ) : pending.length > 0 ? (
          <ScrollView
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          >
            {pending.map((r) => (
              <RequestRow
                key={r.connection_id}
                req={r}
                highlighted={
                  !!highlightRequesterId &&
                  r.requester_user_id === highlightRequesterId
                }
                onAdd={() => onAdd(r)}
                onDecline={() => onDecline(r)}
              />
            ))}
          </ScrollView>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{COPY.requestListEmpty}</Text>
          </View>
        )}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
  },
  close: { padding: 8 },
  list: { paddingTop: 4, paddingBottom: 32 },
  blockWrap: { flex: 1, justifyContent: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayMD,
    color: Colors.secondary,
    textAlign: 'center',
  },
});
