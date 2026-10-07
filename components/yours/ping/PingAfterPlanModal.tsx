import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import PingInline from './PingInline';
import { useObservedUser } from '../../../hooks/useObservedUser';
import { useYoursGrid } from '../../../hooks/useYoursGrid';

/** Keeps the caller's existing completion/navigation behavior after the invitation step. */
export default function PingAfterPlanModal({ planId, onDone }: { planId: string | null; onDone: () => void }) {
  if (!planId) return null;
  return <PlanInvitationSession key={planId} planId={planId} onDone={onDone} />;
}

function PlanInvitationSession({ planId, onDone }: { planId: string; onDone: () => void }) {
  const viewer = useObservedUser();
  const people = useYoursGrid(viewer.error || viewer.isLoading ? undefined : viewer.viewerId);
  const done = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finish = () => {
    if (done.current || !mounted.current || !viewer.isCurrent()) return;
    done.current = true;
    onDoneRef.current();
  };
  const list = people.data ?? [];
  const loaded = !!viewer.viewerId && !viewer.error && !viewer.isLoading && people.isSuccess;
  const empty = loaded && !people.isFetching && list.length === 0;
  useEffect(() => {
    // Only a successful, current empty result may skip this optional step.
    if (empty && viewer.isCurrent()) finish();
  // finish reads the latest navigation callback through a ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty, viewer.epoch]);

  if (empty) return null;
  if (loaded && list.length > 0) {
    return <ReadyInvitation key={`${viewer.viewerId}:${viewer.epoch}`} planId={planId} userId={viewer.viewerId!} onDone={finish} />;
  }
  const loading = viewer.isLoading || (!!viewer.viewerId && !viewer.error && (people.isLoading || (people.isFetching && list.length === 0)));
  const retry = async () => {
    if (loading) return;
    if (!viewer.viewerId || viewer.error) await viewer.retry();
    else await people.refetch();
  };
  return (
    <Modal visible animationType="fade" onRequestClose={finish}>
      <SafeAreaView style={styles.container}>
        <View style={styles.state}>
          <Text style={styles.title}>{loading ? 'Finding your people' : 'Your people couldn’t load'}</Text>
          {loading ? <ActivityIndicator color={Colors.terracotta} accessibilityLabel="Loading your people" /> : <>
            <Text style={styles.description}>You can try again or continue to your plan.</Text>
            <Pressable style={styles.retry} onPress={retry} accessibilityRole="button" accessibilityLabel="Retry loading your people">
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </>}
          <Pressable style={styles.skip} onPress={finish} accessibilityRole="button" accessibilityLabel="Continue without inviting">
            <Text style={styles.skipText}>Not now</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function ReadyInvitation({ planId, userId, onDone }: { planId: string; userId: string; onDone: () => void }) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const finish = () => { if (!busyRef.current) onDone(); };
  return (
    <Modal visible animationType="fade" onRequestClose={finish}>
      <SafeAreaView style={styles.container} accessibilityState={{ busy }}>
        <View style={styles.center}>
          <PingInline userId={userId} planId={planId} onDone={finish} onBusyChange={value => {
            busyRef.current = value;
            setBusy(value);
          }} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  center: { flex: 1, justifyContent: 'center' },
  state: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 20 },
  title: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  description: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.secondary },
  retry: { minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.terracotta, borderRadius: 6 },
  retryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
  skip: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  skipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
});
