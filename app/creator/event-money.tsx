/**
 * Event money tab (Build 35 Screen 07): the event-scoped financial
 * reconciliation view -- gross, processing, our 4%, refunds, and net, plus
 * payout status. Reuses MoneySummaryCard (components/creator/MoneySummaryCard)
 * unchanged, the same card already proven on the Attendees screen, rather
 * than recomputing the same money math a second time.
 *
 * Finance-gated per the delta matrix (Screen 07: "Finance sees refund and
 * payout data; Editor does not by default"). A solo event host
 * (hasEventHostGrant, no community) also sees their own event's numbers,
 * mirroring the existing gate on the account-wide getting-paid screen
 * (app/creator/payouts.tsx) -- RLS (is_ticketing_organizer) is the real
 * security boundary underneath both; this client check only decides which
 * UI renders. Read-only: no refund or payout action lives on this screen.
 * Refunds stay on Attendees (Screen 05), where they already work; Screen 45
 * (per-purchase detail plus an audit-logged action trail) is separate,
 * unbuilt scope that needs its own migration.
 */

import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Lock } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { countAttendees, getEventAttendees, getEventMoneySummary, sumRefundedCentsOnPaidOrders } from '../../lib/ticketAttendees';
import { getCreatorAccess, canManageFinance, type CreatorAccess } from '../../lib/creatorMode';
import { MoneySummaryCard } from '../../components/creator/MoneySummaryCard';

/**
 * Screen-level finance gate: Finance/Owner/Admin (canManageFinance), or a
 * solo event host looking at their own event (hasEventHostGrant). Mirrors
 * payouts.tsx's established gate (`!hasEventHostGrant && !canManageFinance`)
 * at the per-event screen -- RLS still scopes the actual rows to events this
 * user really organizes, so this only decides what the UI shows.
 */
export function canSeeEventMoney(
  access: Pick<CreatorAccess, 'hasEventHostGrant'> | null | undefined,
  canFinance: boolean,
): boolean {
  return canFinance || !!access?.hasEventHostGrant;
}

export default function EventMoneyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: access, isLoading: accessLoading } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const canSeeMoney = canSeeEventMoney(access, canManageFinance(access));

  const { data: attendees = [], isLoading: attendeesLoading } = useQuery({
    queryKey: ['event-attendees', id],
    queryFn: () => getEventAttendees(id!),
    enabled: !!id && canSeeMoney,
    staleTime: 10_000,
  });
  const { data: money, isLoading: moneyLoading } = useQuery({
    queryKey: ['event-money-summary', id],
    queryFn: () => getEventMoneySummary(id!),
    enabled: !!id && canSeeMoney,
    staleTime: 10_000,
  });

  const refundedCents = sumRefundedCentsOnPaidOrders(attendees);
  const ticketsSold = countAttendees(attendees).sold;
  const loading = accessLoading || (canSeeMoney && (attendeesLoading || moneyLoading));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle}>money</Text>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={Colors.terracotta} /></View>
      ) : !canSeeMoney ? (
        <View style={styles.centered}>
          <Lock size={28} color={Colors.textLight} strokeWidth={2} />
          {/* copy to the taste gate -- honest, not a dead end */}
          <Text style={styles.restricted}>money details are visible to this event&apos;s finance team and owner.</Text>
        </View>
      ) : money ? (
        <ScrollView contentContainerStyle={styles.body}>
          <MoneySummaryCard money={money} ticketsSold={ticketsSold} refundedCents={refundedCents} />
        </ScrollView>
      ) : (
        <View style={styles.centered}>
          {/* copy to the taste gate */}
          <Text style={styles.empty}>couldn&apos;t load money for this event.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  headerTitle: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center' },
  restricted: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center', lineHeight: 20 },
  body: { paddingBottom: 40 },
});
