/**
 * Getting paid: the standalone payouts front door (7-27 ship ruling item 4,
 * web parity with /app/creator/payouts), now also Build 35 Screen 10's
 * ledger -- failed-payout exceptions, a per-event reconciliation rolled up
 * to one Organization total, and purchase search + CSV export. Same
 * PayoutsCard as the per-event tickets screen; the release rhythm is stated
 * here because this is the one place an organizer comes asking "when do I
 * get my money".
 *
 * Same screen-level gate as event-money.tsx's canSeeEventMoney (Finance/
 * Owner/Admin, or a solo event host) -- RLS (is_ticketing_organizer) is the
 * real security boundary underneath, this client check only decides what
 * renders. Read-only: no refund or payout action lives here. Refunds stay on
 * Attendees (Screen 05), where they already work; a per-purchase detail view
 * plus an audit-logged action trail is Screen 45, separate, unbuilt scope --
 * so a purchase row here is inert, not a dead link to a screen that doesn't
 * exist yet.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Search } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';
import { hapticLight } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import { openUrl } from '../../lib/url';
import {
  formatCents,
  getFailedPayouts,
  getMyPayoutState,
  getOrganizationPurchases,
  getOrganizationReconciliation,
  getPayoutSummary,
  organizationPurchasesToCsv,
  purchaseStatusLabel,
  requestOnboardingLink,
  searchOrganizationPurchases,
  type OrganizationPurchase,
  type PurchaseStatusLabel,
} from '../../lib/ticketing';
import { failedPayoutLabel } from '../../lib/organizerHome';
import { getCreatorAccess, canManageFinance, creatorLandingRoute } from '../../lib/creatorMode';
import { PayoutsCard } from '../../components/creator/PayoutsCard';
import { EarningsSummaryCard } from '../../components/creator/EarningsSummaryCard';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';

type PurchaseFilter = 'all' | PurchaseStatusLabel;

const PURCHASE_FILTERS: { key: PurchaseFilter; label: string }[] = [
  { key: 'all', label: 'all' },
  { key: 'paid', label: 'paid' },
  { key: 'pending', label: 'pending' },
  { key: 'partial', label: 'partially refunded' },
  { key: 'refunded', label: 'refunded' },
  { key: 'canceled', label: 'canceled' },
];

export default function GettingPaidScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [onboardBusy, setOnboardBusy] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<PurchaseFilter>('all');

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
  const communityIds = useMemo(() => access?.ledCommunities.map((c) => c.id) ?? [], [access]);
  const communityIdsKey = communityIds.join(',');

  const { data: summary } = useQuery({
    queryKey: ['payout-summary', userId, communityIdsKey],
    queryFn: () => getPayoutSummary(communityIds, userId!),
    enabled: !!userId && access != null,
    staleTime: 30_000,
  });

  // Build 35 Screen 10: exception-first, same convention as organizer-home's
  // Screen 01 card -- a stuck payout rises above the routine summary below.
  const { data: failedPayouts = [] } = useQuery({
    queryKey: ['ledger-failed-payouts', userId, communityIdsKey],
    queryFn: () => getFailedPayouts(communityIds, userId!),
    enabled: !!userId && access != null,
    staleTime: 30_000,
  });

  const { data: reconciliation } = useQuery({
    queryKey: ['ledger-reconciliation', userId, communityIdsKey],
    queryFn: () => getOrganizationReconciliation(communityIds, userId!),
    enabled: !!userId && access != null,
    staleTime: 30_000,
  });

  const { data: purchases = [] } = useQuery({
    queryKey: ['ledger-purchases', userId, communityIdsKey],
    queryFn: () => getOrganizationPurchases(communityIds, userId!),
    enabled: !!userId && access != null,
    staleTime: 30_000,
  });

  const filteredPurchases = useMemo(() => {
    const searched = searchOrganizationPurchases(purchases, query);
    return statusFilter === 'all' ? searched : searched.filter((p) => purchaseStatusLabel(p) === statusFilter);
  }, [purchases, query, statusFilter]);

  // native's own share sheet (mail, files, Messages, etc), same real-export
  // pattern as members.tsx's membersToCsv -- always the full fetched set,
  // never the currently-searched/filtered subset.
  const handleExportPurchases = useCallback(async () => {
    if (purchases.length === 0) return;
    hapticLight();
    try {
      await Share.share({ message: organizationPurchasesToCsv(purchases) });
    } catch {
      /* copy to the taste gate */
      setAlertInfo({ title: 'that did not share', message: 'give it another try in a moment.' });
    }
  }, [purchases]);

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
        {failedPayouts.length > 0 && (
          <View style={styles.exceptionCard} accessibilityLabel="payout issues">
            <AlertTriangle size={20} color={Colors.errorRed} strokeWidth={2} />
            <View style={styles.exceptionBody}>
              {/* LIZ COPY: mirrors organizer-home's already-shipped Screen 01 wording */}
              <Text style={styles.exceptionTitle}>{failedPayoutLabel(failedPayouts.length)}</Text>
              {failedPayouts.map((f) => (
                <Text key={f.eventId} style={styles.exceptionMeta} numberOfLines={1}>
                  {f.eventTitle} · we're retrying automatically
                </Text>
              ))}
            </View>
          </View>
        )}

        <PayoutsCard payout={payout} onboardBusy={onboardBusy} onOnboard={handleOnboard} />

        {summary && <EarningsSummaryCard summary={summary} />}

        {reconciliation && reconciliation.rows.length > 0 && (
          <View style={styles.section}>
            {/* copy to the taste gate */}
            <Text style={styles.sectionLabel}>by event</Text>
            {reconciliation.rows.map((r) => (
              <View key={r.eventId} style={styles.reconRow}>
                <View style={styles.reconTop}>
                  <Text style={styles.reconTitle} numberOfLines={1}>{r.eventTitle}</Text>
                  <Text style={styles.reconNet}>{formatCents(r.netToYouCents)}</Text>
                </View>
                {/* copy to the taste gate */}
                <Text style={styles.reconMeta}>
                  {r.ticketsSold} sold · gross {formatCents(r.grossFaceCents)} · our 4% {formatCents(r.commissionCents)}
                  {r.refundedCents > 0 ? ` · refunded ${formatCents(r.refundedCents)}` : ''}
                  {r.payoutStatus ? ` · payout ${r.payoutStatus.replace(/_/g, ' ')}` : ''}
                </Text>
              </View>
            ))}
            <View style={styles.reconTotalRow}>
              {/* copy to the taste gate */}
              <Text style={styles.reconTotalLabel}>organization total</Text>
              <Text style={styles.reconTotalValue}>{formatCents(reconciliation.totals.netToYouCents)}</Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            {/* copy to the taste gate */}
            <Text style={styles.sectionLabel}>purchases</Text>
            {purchases.length > 0 && (
              <TouchableOpacity onPress={handleExportPurchases} hitSlop={12} accessibilityRole="button" accessibilityLabel="export purchases">
                {/* LIZ COPY */}
                <Text style={styles.exportLink}>export</Text>
              </TouchableOpacity>
            )}
          </View>

          {purchases.length > 0 && (
            <>
              <View style={styles.searchRow}>
                <Search size={16} color={Colors.textLight} strokeWidth={2.25} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="search a name or event"
                  placeholderTextColor={Colors.textLight}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="search purchases by buyer name or event"
                />
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                {PURCHASE_FILTERS.map((f) => (
                  <TouchableOpacity
                    key={f.key}
                    style={[styles.chip, statusFilter === f.key && styles.chipOn]}
                    onPress={() => { hapticLight(); setStatusFilter(f.key); }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: statusFilter === f.key }}
                  >
                    <Text style={[styles.chipText, statusFilter === f.key && styles.chipTextOn]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {purchases.length === 0 ? (
            /* copy to the taste gate (empty-state, an invitation not a dead end) */
            <Text style={styles.empty}>nothing sold yet. once tickets move, purchases show up here.</Text>
          ) : filteredPurchases.length === 0 ? (
            <Text style={styles.empty}>no purchases match that search.</Text>
          ) : (
            filteredPurchases.map((p) => <PurchaseRow key={p.orderId} purchase={p} />)
          )}
        </View>

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

function PurchaseRow({ purchase }: { purchase: OrganizationPurchase }) {
  const label = purchaseStatusLabel(purchase);
  const labelText = label === 'partial' ? 'partially refunded' : label;
  const muted = label === 'refunded' || label === 'partial' || label === 'canceled';
  return (
    <View style={styles.purchaseRow}>
      <View style={styles.purchaseBody}>
        <Text style={styles.purchaseName} numberOfLines={1}>{purchase.buyerName}</Text>
        <Text style={styles.purchaseMeta} numberOfLines={1}>
          {purchase.eventTitle}{purchase.tierName ? ` · ${purchase.tierName}` : ''}
        </Text>
      </View>
      <View style={styles.purchaseAmountWrap}>
        <Text style={styles.purchaseAmount}>{formatCents(purchase.totalCents)}</Text>
        <Text style={[styles.purchaseStatus, muted && styles.purchaseStatusMuted]}>{labelText}</Text>
      </View>
    </View>
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

  exceptionCard: {
    flexDirection: 'row', gap: 10,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.errorRed,
    padding: 14,
  },
  exceptionBody: { flex: 1, gap: 2 },
  exceptionTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  exceptionMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },

  section: { gap: 8 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: {
    fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  exportLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.textMedium },

  reconRow: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 12, gap: 4,
  },
  reconTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  reconTitle: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  reconNet: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  reconMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  reconTotalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 10, marginTop: 4,
  },
  reconTotalLabel: {
    fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.textMedium,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  reconTotalValue: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 11,
  },
  searchInput: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  chipsRow: { gap: 8, paddingVertical: 2 },
  chip: {
    borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
    paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: 'center',
  },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  chipTextOn: { color: Colors.white },

  purchaseRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 12, minHeight: 44,
  },
  purchaseBody: { flex: 1, gap: 2 },
  purchaseName: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  purchaseMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  purchaseAmountWrap: { alignItems: 'flex-end', gap: 2 },
  purchaseAmount: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  purchaseStatus: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.textMedium },
  purchaseStatusMuted: { color: Colors.textLight },

  empty: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium,
    textAlign: 'center', paddingVertical: 12,
  },
});
