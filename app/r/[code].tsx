/** Referral entry preserves inviter-to-recipient direction; unknown results stay retryable. */
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScaledText as Text } from '../../components/ScaledText';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { unauthedRoute } from '../../lib/authRouting';
import { stashPendingReferral } from '../../lib/yours/referralLink';
import { claimReferralForRecipient } from '../../lib/yours/referralClaim';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { useObservedUser } from '../../hooks/useObservedUser';
import { YOURS_PAGE_ENABLED } from '../../constants/FeatureFlags';

type State = 'loading' | 'retry' | 'unavailable' | 'accountChanged';
export default function ReferralLanding() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const account = useObservedUser({ allowSignedOut: true });
  const [state, setState] = useState<State>('loading');
  const [attempt, setAttempt] = useState(0);
  const visit = useRef<object | null>(null);
  const [renderVisit, setRenderVisit] = useState<object | null>(null);
  const owner = useMemo(() => ({ identity: null as { id: string | null; epoch: number } | null }), [code]);
  const busy = useRef(false);
  useFocusEffect(useCallback(() => {
    const activeVisit = {}; visit.current = activeVisit; setRenderVisit(activeVisit); busy.current = true;
    const current = () => visit.current === activeVisit && account.isCurrent();
    setState('loading');
    void (async () => {
      if (!code || typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(code)) { if (current()) setState('unavailable'); return; }
      if (account.isLoading) return;
      if (account.error || account.viewerId === undefined) { if (current()) setState('retry'); return; }
      if (!owner.identity) owner.identity = { id: account.viewerId, epoch: account.epoch };
      if (owner.identity.id !== account.viewerId || owner.identity.epoch !== account.epoch) { if (current()) setState('accountChanged'); return; }
      if (!account.viewerId) {
        try {
          await requestWithDeadline(stashPendingReferral(code), 12_000);
          if (current()) router.replace(unauthedRoute() as never);
        } catch { if (current()) setState('retry'); }
        return;
      }
      const result = await claimReferralForRecipient(code, { userId: account.viewerId, isCurrent: current });
      if (!current() || result.status === 'stale') return;
      if (result.status === 'connected') router.replace((YOURS_PAGE_ENABLED ? `/person/${result.inviterId}` : '/(tabs)/plans') as never);
      else setState(result.status);
    })().finally(() => { if (visit.current === activeVisit) busy.current = false; });
    return () => { if (visit.current === activeVisit) visit.current = null; };
  }, [code, account.viewerId, account.epoch, account.isCurrent, account.isLoading, account.error, owner, attempt]));

  const canAct = () => !!renderVisit && visit.current === renderVisit && account.isCurrent();
  const retry = () => {
    if (!canAct() || busy.current) return;
    busy.current = true;
    if (account.error) void account.retry();
    else setAttempt(value => value + 1);
  };
  if (state === 'loading') return <View style={styles.loading}><ActivityIndicator size="large" color={Colors.terracotta} /></View>;
  const unavailable = state === 'unavailable', changed = state === 'accountChanged';
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.centered}>
        <Text style={styles.title}>{unavailable ? 'this invite is unavailable' : changed ? 'your account changed' : 'couldn’t open this invite'}</Text>
        <Text style={styles.body}>{unavailable ? 'This invite can’t be used right now. You can still explore plans.' : changed ? 'Open the invite again to use it with your current account.' : 'We couldn’t confirm the connection. Please try again.'}</Text>
        {state === 'retry' && <TouchableOpacity style={styles.cta} onPress={retry} accessibilityRole="button" accessibilityLabel="Try invite again">
          <Text style={styles.ctaText}>try again</Text>
        </TouchableOpacity>}
        <TouchableOpacity style={styles.cta} onPress={() => { if (canAct()) { visit.current = null; router.replace('/(tabs)/plans' as never); } }} accessibilityRole="button" accessibilityLabel="See plans">
          <Text style={styles.ctaText}>see what's on</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.parchment },
  centered: { flexGrow: 1, paddingVertical: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  title: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  body: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center' },
  cta: {
    marginTop: 12, backgroundColor: Colors.terracotta, borderRadius: 999,
    paddingVertical: 14, paddingHorizontal: 28, minHeight: 44, justifyContent: 'center',
  },
  ctaText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
