import React from 'react';
import { Modal, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '../../../constants/Colors';
import PingInline from './PingInline';
import { useAuthUserId } from '../state/useAuthUserId';
import { useYoursGrid } from '../../../hooks/useYoursGrid';

/**
 * Self-contained ping overlay for the post-create / post-join moment.
 * Resolves its own auth user so the host screens only manage a planId.
 * onDone runs the host's original navigation. If the user has no people
 * yet, it dismisses immediately (nothing to ping).
 */
export default function PingAfterPlanModal({
  planId,
  onDone,
}: {
  planId: string | null;
  onDone: () => void;
}) {
  const { data: userId } = useAuthUserId();
  // People list drives whether there's anyone to ping. Loaded here — once,
  // in the modal — rather than at the two host call sites (post-create /
  // post-join), so the guard lives in one place and we never flash an
  // empty ping strip or fire a wasted ping RPC for a user with no people.
  const { data: people = [], isLoading: peopleLoading } = useYoursGrid(userId);
  if (!planId) return null;
  if (!userId) {
    onDone();
    return null;
  }
  // Wait for the people query before deciding (don't false-dismiss on the
  // first render), then if the user has no people, run the host's original
  // navigation immediately and render nothing.
  if (peopleLoading) return null;
  if (people.length === 0) {
    onDone();
    return null;
  }
  return (
    <Modal visible animationType="fade" onRequestClose={onDone}>
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <PingInline userId={userId} planId={planId} onDone={onDone} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  center: { flex: 1, justifyContent: 'center' },
});
