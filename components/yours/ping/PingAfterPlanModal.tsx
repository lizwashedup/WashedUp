import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, View, ScrollView, StyleSheet } from 'react-native';
import { ScaledText as Text } from '../../ScaledText';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import PingInline from './PingInline';
import { useObservedUser } from '../../../hooks/useObservedUser';
import { useYoursGrid } from '../../../hooks/useYoursGrid';
import type { YoursGridPerson } from '../../../lib/yours/types';
import type { PeopleConnectionScope } from '../../../hooks/usePeopleConnectionMutations';

/** Keeps the caller's existing completion/navigation behavior after the invitation step. */
export default function PingAfterPlanModal({ planId, onDone }: { planId: string | null; onDone: () => void }) {
  if (!planId) return null;
  return <PlanInvitationSession key={planId} planId={planId} onDone={onDone} />;
}

function PlanInvitationSession({ planId, onDone }: { planId: string; onDone: () => void }) {
  const viewer = useObservedUser();
  const people = useYoursGrid(viewer.error || viewer.isLoading ? undefined : viewer.viewerId, viewer.viewerId ? {
    userId: viewer.viewerId, epoch: viewer.epoch, isCurrent: viewer.isCurrent,
  } : undefined);
  const list = people.data ?? [];
  const loaded = !!viewer.viewerId && !viewer.error && !viewer.isLoading && people.isSuccess;
  const empty = loaded && !people.isFetching && list.length === 0;
  const initiallyEmpty = useRef(empty);
  const [closing, setClosing] = useState(false);
  const done = useRef(false);
  const pending = useRef<null | (() => boolean)>(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const latest = useRef({ viewer, onDone });
  latest.current = { viewer, onDone };
  const owner = `${viewer.viewerId}:${viewer.epoch}`;
  const busy = useRef({ owner, value: false });
  const retrying = useRef<{ owner: string } | null>(null);
  if (busy.current.owner !== owner) busy.current = { owner, value: false };
  const complete = () => {
    const isCurrent = pending.current;
    if (!isCurrent || done.current || !mounted.current) return;
    pending.current = null;
    done.current = true;
    if (isCurrent()) latest.current.onDone();
  };
  const finish = () => {
    if (done.current || pending.current || busy.current.value || !mounted.current || !viewer.isCurrent()) return;
    pending.current = () => viewer.isCurrent() && latest.current.viewer.viewerId === viewer.viewerId && latest.current.viewer.epoch === viewer.epoch;
    setClosing(true);
    // A cached empty result never presents a window. Otherwise iOS must finish
    // dismissing this one before the parent opens a ticket sheet or chat.
    if (Platform.OS !== 'ios' || initiallyEmpty.current) complete();
  };
  useEffect(() => {
    if (empty && viewer.isCurrent()) finish();
  // Completion is scoped to the current account and invitation session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty, viewer.epoch]);

  const loading = viewer.isLoading || (!!viewer.viewerId && !viewer.error && (people.isLoading || (people.isFetching && list.length === 0)));
  const retry = async () => {
    if (loading || closing || pending.current || done.current || !mounted.current || !viewer.isCurrent() || retrying.current?.owner === owner) return;
    const attempt = { owner }; retrying.current = attempt;
    try {
      if (!viewer.viewerId || viewer.error) await viewer.retry();
      else await people.refetch();
    } catch { /* The observed read owns its visible error; no unhandled retry rejection. */ }
    finally { if (retrying.current === attempt) retrying.current = null; }
  };
  return (
    <Modal visible={!closing && !initiallyEmpty.current} animationType="fade" onRequestClose={finish} onDismiss={complete}>
      {loaded && list.length > 0 ? <ReadyInvitation key={owner} planId={planId} userId={viewer.viewerId!} people={list} operationScope={{ userId: viewer.viewerId!, isCurrent: () => !closing && !done.current && !pending.current && mounted.current && viewer.isCurrent() }} onDone={finish} onBusyChange={value => {
        if (busy.current.owner === owner && viewer.isCurrent()) busy.current.value = value;
      }} /> : <SafeAreaView style={styles.container}>
        <ScrollView style={styles.stateScroll} contentContainerStyle={styles.state}>
          <Text style={styles.title}>{empty ? 'You’re all set' : loading ? 'Finding your people' : 'Your people couldn’t load'}</Text>
          {loading || empty ? <ActivityIndicator color={Colors.terracotta} accessibilityLabel="Loading your people" /> : <>
            <Text style={styles.description}>You can try again or continue to your plan.</Text>
            <Pressable style={styles.retry} onPress={retry} accessibilityRole="button" accessibilityLabel="Retry loading your people">
              <Text style={styles.retryText} numberOfLines={1} adjustsFontSizeToFit>Try again</Text>
            </Pressable>
          </>}
        </ScrollView>
        <Pressable style={styles.skip} onPress={finish} accessibilityRole="button" accessibilityLabel="Continue without inviting">
          <Text style={styles.skipText} numberOfLines={1} adjustsFontSizeToFit>Not now</Text>
        </Pressable>
      </SafeAreaView>}
    </Modal>
  );
}

function ReadyInvitation({ planId, userId, people, operationScope, onDone, onBusyChange }: { planId: string; userId: string; people: YoursGridPerson[]; operationScope: PeopleConnectionScope; onDone: () => void; onBusyChange: (busy: boolean) => void }) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const finish = () => { if (!busyRef.current) onDone(); };
  return (
      <SafeAreaView style={styles.container} accessibilityState={{ busy }}>
        <View style={styles.center}>
          <PingInline userId={userId} planId={planId} people={people} operationScope={operationScope} onDone={finish} onBusyChange={value => {
            busyRef.current = value;
            onBusyChange(value);
            setBusy(value);
          }} />
        </View>
      </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  center: { flex: 1, justifyContent: 'center' },
  stateScroll: { flex: 1, minHeight: 0 },
  state: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 20 },
  title: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  description: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.secondary },
  retry: { minHeight: 48, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.terracotta, borderRadius: 6 },
  retryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
  skip: { minHeight: 44, paddingHorizontal: 24, paddingVertical: 12, justifyContent: 'center', alignItems: 'center' },
  skipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
});
