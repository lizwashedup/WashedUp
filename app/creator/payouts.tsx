/**
 * Getting paid: the standalone payouts front door (7-27 ship ruling item 4,
 * web parity with /app/creator/payouts). Reachable from the creator menu
 * WITHOUT an event, so an organizer can finish Stripe before their first
 * listing exists. Same PayoutsCard as the per-event tickets screen; the
 * release rhythm is stated here because this is the one place an organizer
 * comes asking "when do I get my money".
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';
import { hapticLight } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import { openUrl } from '../../lib/url';
import { getMyPayoutState, getPayoutSummary, requestOnboardingLink } from '../../lib/ticketing';
import { getCreatorAccess, canManageFinance, creatorLandingRoute } from '../../lib/creatorMode';
import { PayoutsCard } from '../../components/creator/PayoutsCard';
import { EarningsSummaryCard } from '../../components/creator/EarningsSummaryCard';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';

export default function GettingPaidScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [onboardBusy, setOnboardBusy] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)).catch(() => {});
  }, []);

  const { data: payout } = useQuery({
    queryKey: ['payout-state', userId],
    queryFn: () => getMyPayoutState(userId!),
    enabled: !!userId,
    staleTime: 30_000,
  });

  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });

  const { data: summary } = useQuery({
    queryKey: ['payout-summary', userId, access?.ledCommunities.map((c) => c.id).join(',')],
    queryFn: () => getPayoutSummary((access?.ledCommunities ?? []).map((c) => c.id), userId!),
    enabled: !!userId && access != null,
    staleTime: 30_000,
  });

  const handleOnboard = useCallback(async () => {
    if (onboardBusy) return;
    hapticLight();
    setOnboardBusy(true);
    const result = await requestOnboardingLink();
    setOnboardBusy(false);
    if (result.ok) {
      openUrl(result.url);
      return;
    }
    setAlertInfo({
      /* copy to the taste gate: the real reason, and a way to try again */
      title: 'that did not open',
      message: result.message,
      buttons: [
        { text: 'not now', style: 'cancel' },
        { text: 'try again', onPress: () => { handleOnboardRef.current?.(); } },
      ],
    });
  }, [onboardBusy]);

  // the retry button calls back into the latest handler without making the
  // callback depend on itself
  const handleOnboardRef = useRef<(() => void) | null>(null);
  handleOnboardRef.current = handleOnboard;

  if (access && !access.hasEventHostGrant && !canManageFinance(access)) {
    return <Redirect href={creatorLandingRoute(access)} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle}>getting paid</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <PayoutsCard payout={payout} onboardBusy={onboardBusy} onOnboard={handleOnboard} />

        {summary && <EarningsSummaryCard summary={summary} />}

        {/* the release rhythm, stated plainly (doc 61 §3: payouts release
            after the event ends, never before). copy to the taste gate */}
        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>how the money moves</Text>
          <Text style={styles.noteText}>ticket money collects with stripe while your event sells.</Text>
          <Text style={styles.noteText}>after the event ends, your payout releases to your bank.</Text>
          <Text style={styles.noteText}>the 4% is all-in. there is nothing else taken out.</Text>
        </View>
      </ScrollView>

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  headerTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  headerSpacer: { flex: 1 },
  content: { padding: 20, gap: EventSpacing.md },
  noteCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 6,
  },
  noteTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  noteText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, lineHeight: 19 },
});
