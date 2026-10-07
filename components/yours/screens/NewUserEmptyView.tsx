import React, { useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import Colors, { AfterglowColors as C, CreatorSurfaceColors as G } from '../../../constants/Colors';
import { AfterglowType as T } from '../../../constants/Typography';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { useNearbyPlans } from '../../../hooks/useNearbyPlans';
import { GoldSurfaceFill } from '../../creator/GoldSurfaceFill';
import NearbyPlanCard from '../nearby/NearbyPlanCard';

/** People starts with an invitation; upcoming plans appear only when useful. */
export default function NewUserEmptyView({ onInvite }: { onInvite: () => void }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const { data: plans = [], isLoading, isFetching, isError, refetch } = useNearbyPlans(true);
  const pendingRetry = useRef(false);
  const hasPlans = plans.length > 0;
  const showPlans = hasPlans || isLoading || isFetching || isError;
  const retry = () => {
    if (pendingRetry.current || isFetching) return;
    pendingRetry.current = true;
    void refetch({ cancelRefetch: false })
      .catch(() => { /* The query owns the visible error state. */ })
      .finally(() => { pendingRetry.current = false; });
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.welcome}>
        <GoldSurfaceFill radius={20} />
        <Text accessibilityRole="header" style={[styles.title, { fontFamily: fonts.display }]}>
          Keep your people close
        </Text>
        <Text style={[styles.welcomeBody, { fontFamily: fonts.regular }]}>
          Meet at a plan. Keep in touch here.
        </Text>
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Invite a friend"
        accessibilityHint="Bring someone you know along."
        onPress={onInvite} style={({ pressed }) => [styles.invite, pressed && styles.pressed]}>
        <View style={styles.inviteCopy}>
          <Text style={[styles.inviteTitle, { fontFamily: fonts.medium }]}>Invite a friend</Text>
          <Text style={[styles.body, { fontFamily: fonts.regular }]}>Bring someone you know along.</Text>
        </View>
        <ChevronRight size={20} color={C.muted} accessible={false} />
      </Pressable>

      {showPlans && <View style={styles.plans}>
        <Text accessibilityRole="header" style={[styles.section, { fontFamily: fonts.medium }]}>Upcoming plans</Text>
        {!hasPlans && !isError && <View style={styles.loading} accessibilityLiveRegion="polite">
          <ActivityIndicator color={Colors.terracotta} accessibilityLabel="Loading upcoming plans" />
          <Text style={[styles.body, styles.loadingCopy, { fontFamily: fonts.regular }]}>Finding upcoming plans…</Text>
        </View>}
        {isError && <View style={styles.recovery} accessibilityLiveRegion="polite">
          <Text style={[styles.body, { fontFamily: fonts.regular }]}>
            {hasPlans ? 'Couldn’t refresh these plans.' : 'Plans couldn’t load.'}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Try again"
            accessibilityState={{ disabled: isFetching, busy: isFetching }} disabled={isFetching}
            onPress={retry} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
            <Text style={[styles.retryLabel, { fontFamily: fonts.medium }]}>{isFetching ? 'Retrying…' : 'Try again'}</Text>
          </Pressable>
        </View>}
        {hasPlans && <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cards} keyboardShouldPersistTaps="handled">
          {plans.map(plan => <NearbyPlanCard key={plan.id} plan={plan} />)}
        </ScrollView>}
      </View>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { paddingTop: 16, paddingBottom: 32, gap: 12 },
  welcome: {
    marginHorizontal: 20, padding: 20, gap: 8, borderRadius: 20,
    backgroundColor: G.selectionTop, borderWidth: 1, borderColor: G.goldEdge,
  },
  title: { ...T.identity, color: C.ink },
  welcomeBody: { ...T.body, color: C.ink },
  invite: {
    marginHorizontal: 20, padding: 16, minHeight: 64, gap: 12,
    flexDirection: 'row', alignItems: 'center', borderRadius: 18,
    backgroundColor: C.white, borderWidth: 1, borderColor: C.subtleLine,
  },
  inviteCopy: { flex: 1, minWidth: 0, gap: 4 },
  inviteTitle: { ...T.title, color: C.ink },
  body: { ...T.body, color: C.muted },
  pressed: { opacity: 0.8 },
  plans: { paddingTop: 12, gap: 12 },
  section: { ...T.title, color: C.ink, paddingHorizontal: 20 },
  loading: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingCopy: { flex: 1, minWidth: 0 },
  recovery: { paddingHorizontal: 20, gap: 8, alignItems: 'flex-start' },
  retry: {
    minHeight: 44, paddingHorizontal: 18, paddingVertical: 12, justifyContent: 'center',
    borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.white,
  },
  retryLabel: { ...T.body, color: C.clay },
  cards: { paddingHorizontal: 20 },
});
