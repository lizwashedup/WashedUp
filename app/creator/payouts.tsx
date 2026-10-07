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
 * renders. Read-only: no refund action lives directly on this list. Refunds
 * happen on the purchase itself now: Screen 45 (app/creator/purchase/[id].tsx)
 * is built, so a purchase row below opens it rather than sitting inert.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { router, Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Search } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';
import { hapticLight } from '../../lib/haptics';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
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
  syncMyPayoutState,
  type OrganizationPurchase,
  type PurchaseStatusLabel,
} from '../../lib/ticketing';
import { failedPayoutLabel } from '../../lib/organizerHome';
import { getCreatorAccess, canManageFinance, creatorLandingRoute } from '../../lib/creatorMode';
import { PageFrame } from '../../components/creator/pages/PageFrame';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { PayoutsCard } from '../../components/creator/PayoutsCard';
import { EarningsSummaryCard } from '../../components/creator/EarningsSummaryCard';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';

type PurchaseFilter = 'all' | PurchaseStatusLabel;

const PURCHASE_FILTERS: { key: PurchaseFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'paid', label: 'Paid' },
  { key: 'pending', label: 'Pending' },
  { key: 'partial', label: 'Partially refunded' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'canceled', label: 'Canceled' },
];

export default function GettingPaidScreen() {
  const {fonts} = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => makeStyles(fonts), [fonts]);
  const { stripe } = useLocalSearchParams<{ stripe?: string }>();
  const {scope, account, focused} = useCreatorPageScope('payouts');
  const userId = scope?.userId ?? null;
  const boundedRead = useCallback(async <T,>(read: (owned: CreatorPageScope) => Promise<T>) => {
    if (!scope?.isCurrent()) throw Error('Check your account to load payouts.');
    let active = true;
    const owned = {userId: scope.userId, isCurrent: () => active && scope.isCurrent()};
    try { const value = await requestWithDeadline(read(owned), 12_000); if (!owned.isCurrent()) throw Error('This visit has ended.'); return value; }
    finally { active = false; }
  }, [scope]);
  const [onboardBusy, setOnboardBusy] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<PurchaseFilter>('all');


  const payoutRead = useQuery({
    queryKey: ['payout-state', userId],
    queryFn: () => boundedRead(owned => getMyPayoutState(userId!, owned)),
    enabled: !!scope && focused && !account.error && !account.isLoading,
    staleTime: 30_000,
    retry: false,
  });
  const {data: payout, refetch: refetchPayout} = payoutRead;

  // Stripe returns to this screen after the person completes, pauses, or
  // leaves onboarding. Re-check immediately on focus so the setup card never
  // shows the state from before they went to Stripe.
  useFocusEffect(
    useCallback(() => {
      if (userId) void refetchPayout();
    }, [refetchPayout, userId]),
  );

  const accessRead = useQuery({queryKey: ['creator-access', userId, account.epoch], queryFn: () => boundedRead(() => getCreatorAccess()), retry:false, enabled: !!scope && focused && !account.error && !account.isLoading});
  const access = accessRead.data;
  const canReadLedger = !!scope && focused && !account.error && !account.isLoading && accessRead.isSuccess && !accessRead.isError;
  const communityIds = useMemo(() => access?.ledCommunities.map((c) => c.id) ?? [], [access]);
  const communityIdsKey = communityIds.join(',');

  const summaryRead = useQuery({
    queryKey: ['payout-summary', userId, communityIdsKey],
    queryFn: () => boundedRead(owned => getPayoutSummary(communityIds, userId!, owned)),
    enabled: canReadLedger && access != null,
    staleTime: 30_000,
    retry: false,
  });

  // Build 35 Screen 10: exception-first, same convention as organizer-home's
  // Screen 01 card -- a stuck payout rises above the routine summary below.
  const failedRead = useQuery({
    queryKey: ['ledger-failed-payouts', userId, communityIdsKey],
    queryFn: () => boundedRead(owned => getFailedPayouts(communityIds, userId!, owned)),
    enabled: canReadLedger && access != null,
    staleTime: 30_000,
    retry: false,
  });

  const reconciliationRead = useQuery({
    queryKey: ['ledger-reconciliation', userId, communityIdsKey],
    queryFn: () => boundedRead(owned => getOrganizationReconciliation(communityIds, userId!, owned)),
    enabled: canReadLedger && access != null,
    staleTime: 30_000,
    retry: false,
  });

  const purchasesRead = useQuery({
    queryKey: ['ledger-purchases', userId, communityIdsKey],
    queryFn: () => boundedRead(owned => getOrganizationPurchases(communityIds, userId!, owned)),
    enabled: canReadLedger && access != null,
    staleTime: 30_000,
    retry: false,
  });

  const summary = summaryRead.isError ? undefined : summaryRead.data;
  const failedPayouts = failedRead.isError ? [] : failedRead.data ?? [];
  const reconciliation = reconciliationRead.isError ? undefined : reconciliationRead.data;
  const purchases = purchasesRead.isError ? [] : purchasesRead.data ?? [];
  const navigationGate = useRef({onboard:false,export:false,purchases});
  navigationGate.current = {onboard:canReadLedger && payoutRead.isSuccess && !payoutRead.isError && !payoutRead.isFetching,
    export:canReadLedger && purchasesRead.isSuccess && !purchasesRead.isError && !purchasesRead.isFetching,purchases};
  const readStatus = (label:string, reading:{isError:boolean;isPending:boolean;isFetching:boolean;refetch:(options?:{cancelRefetch?:boolean})=>Promise<unknown>}) =>
    reading.isError || reading.isPending ? <View style={styles.readNotice}>
      <Text accessibilityRole={reading.isError ? 'alert' : undefined} style={styles.noteText}>{reading.isError ? `Couldn’t load ${label.toLowerCase()}.` : `Loading ${label.toLowerCase()}…`}</Text>
      {reading.isError && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Retry ${label.toLowerCase()}`} disabled={reading.isFetching} accessibilityState={{disabled:reading.isFetching}} style={styles.readRetry}
        onPress={() => {if (scope?.isCurrent() && !reading.isFetching) void reading.refetch({cancelRefetch:false});}}><Text style={styles.exportLink}>{reading.isFetching ? 'Retrying…' : 'Try again'}</Text></TouchableOpacity>}
    </View> : null;

  const filteredPurchases = useMemo(() => {
    const searched = searchOrganizationPurchases(purchases, query);
    return statusFilter === 'all' ? searched : searched.filter((p) => purchaseStatusLabel(p) === statusFilter);
  }, [purchases, query, statusFilter]);

  // native's own share sheet (mail, files, Messages, etc), same real-export
  // pattern as members.tsx's membersToCsv -- always the full fetched set,
  // never the currently-searched/filtered subset.
  const handleExportPurchases = useCallback(async () => {
    if (!scope?.isCurrent() || !navigationGate.current.export || navigationGate.current.purchases !== purchases || purchases.length === 0) return;
    hapticLight();
    try {
      await Share.share({ message: organizationPurchasesToCsv(purchases) });
    } catch {
      /* copy to the taste gate */
      setAlertInfo({ title: 'that did not share', message: 'give it another try in a moment.' });
    }
  }, [purchases, scope]);

  const handleOnboard = useCallback(async () => {
    if (!scope?.isCurrent() || !navigationGate.current.onboard || onboardBusy) return;
    hapticLight();
    setOnboardBusy(true);
    const result = await requestOnboardingLink();
    if (!scope?.isCurrent()) return;
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
  }, [onboardBusy, scope]);

  // the retry button calls back into the latest handler without making the
  // callback depend on itself
  const handleOnboardRef = useRef<(() => void) | null>(null);
  handleOnboardRef.current = handleOnboard;

  // Stripe sends an expired or already-used Account Link to the refresh
  // bridge. Once that bridge reopens the app, mint and open a fresh link
  // automatically, as required by Stripe's hosted-onboarding contract.
  const handledStripeRefresh = useRef(false);
  useEffect(() => {
    if (stripe !== 'refresh' || handledStripeRefresh.current || !navigationGate.current.onboard) return;
    handledStripeRefresh.current = true;
    router.setParams({ stripe: undefined });
    void handleOnboard();
  }, [handleOnboard, stripe, payoutRead.isFetching, accessRead.isSuccess]);

  // The webhook worker runs once per minute. A creator returning from Stripe
  // should not see stale pre-onboarding state or be sent through the flow
  // again while that worker catches up, so synchronize Stripe directly first.
  const handledStripeReturn = useRef(false);
  useEffect(() => {
    if (stripe !== 'return' || handledStripeReturn.current) return;
    handledStripeReturn.current = true;
    router.setParams({ stripe: undefined });
    let alive = true;
    setOnboardBusy(true);
    void syncMyPayoutState().finally(async () => {
      await refetchPayout();
      if (alive) setOnboardBusy(false);
    });
    return () => {
      alive = false;
    };
  }, [refetchPayout, stripe]);

  if (account.isLoading || account.error || !scope || accessRead.isPending || accessRead.isError) return <PageFrame title="Getting paid" onBack={() => router.back()}>
    <View style={styles.content}>{account.error ? <><Text style={styles.noteText}>Couldn’t check your account.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry account" style={styles.readRetry} onPress={() => void account.retry()}><Text style={styles.exportLink}>Try again</Text></TouchableOpacity></> : !scope && !account.isLoading ? <Text style={styles.noteText}>Sign in to view payouts.</Text> : readStatus('Payout access', accessRead)}</View>
  </PageFrame>;

  if (!access) return <PageFrame title="Getting paid" onBack={() => router.back()}><View style={styles.content}><Text style={styles.noteText}>Payout tools aren’t available to this account.</Text></View></PageFrame>;

  if (access && !access.hasEventHostGrant && !canManageFinance(access)) {
    return <Redirect href={creatorLandingRoute(access)} />;
  }

  return (
    <PageFrame title="Getting paid" onBack={() => router.back()}>
      <View style={styles.content}>
        {readStatus('Payout issues', failedRead)}
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

        {readStatus('Payout setup', payoutRead)}
        {!payoutRead.isError && !payoutRead.isPending && <PayoutsCard appearance={{fonts}} payout={payout} onboardBusy={onboardBusy || payoutRead.isFetching} onOnboard={handleOnboard} />}

        {readStatus('Earnings summary', summaryRead)}
        {summary && <EarningsSummaryCard appearance={{fonts}} summary={summary} />}

        {readStatus('Event breakdown', reconciliationRead)}
        {reconciliation && reconciliation.rows.length > 0 && (
          <View style={styles.section}>
            {/* copy to the taste gate */}
            <Text style={styles.sectionLabel}>By event</Text>
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
              <Text style={styles.reconTotalLabel}>Overall total</Text>
              <Text style={styles.reconTotalValue}>{formatCents(reconciliation.totals.netToYouCents)}</Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            {/* copy to the taste gate */}
            <Text style={styles.sectionLabel}>Purchases</Text>
            {purchases.length > 0 && (
              <TouchableOpacity disabled={!navigationGate.current.export} onPress={handleExportPurchases} hitSlop={12} accessibilityRole="button" accessibilityLabel="export purchases">
                {/* LIZ COPY */}
                <Text style={styles.exportLink}>Export</Text>
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
                  placeholder="Search a name or event"
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

          {purchasesRead.isError || purchasesRead.isPending ? readStatus('Purchases', purchasesRead) : purchases.length === 0 ? (
            /* copy to the taste gate (empty-state, an invitation not a dead end) */
            <Text style={styles.empty}>Nothing sold yet. Once tickets move, purchases show up here.</Text>
          ) : filteredPurchases.length === 0 ? (
            <Text style={styles.empty}>No purchases match that search.</Text>
          ) : (
            filteredPurchases.map((p) => <PurchaseRow key={p.orderId} purchase={p} fonts={fonts} />)
          )}
        </View>

        {/* the release rhythm, stated plainly (doc 61 §3: payouts release
            after the event ends, never before). copy to the taste gate */}
        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>How the money moves</Text>
          <Text style={styles.noteText}>Ticket money collects with Stripe while your event sells.</Text>
          <Text style={styles.noteText}>After the event ends, your payout releases to your bank.</Text>
          <Text style={styles.noteText}>The 4% is all-in. There is nothing else taken out.</Text>
        </View>
      </View>

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </PageFrame>
  );
}

function PurchaseRow({ purchase, fonts }: { purchase: OrganizationPurchase; fonts: AfterglowFontFamilies }) {
  const styles = useMemo(() => makeStyles(fonts), [fonts]);
  const label = purchaseStatusLabel(purchase);
  const labelText = label === 'partial' ? 'partially refunded' : label;
  const muted = label === 'refunded' || label === 'partial' || label === 'canceled';
  return (
    <TouchableOpacity
      style={styles.purchaseRow}
      onPress={() => { hapticLight(); router.push(`/creator/purchase/${purchase.orderId}` as never); }}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`open purchase by ${purchase.buyerName}`}
    >
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
    </TouchableOpacity>
  );
}

const makeStyles = (fonts: AfterglowFontFamilies) => StyleSheet.create({
  readNotice: { gap: 8, paddingVertical: 8 },
  readRetry: {minWidth:44,minHeight:44,justifyContent:'center'},
  content: { gap: EventSpacing.md },
  noteCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 6,
  },
  noteTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  noteText: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium, lineHeight: 19 },

  exceptionCard: {
    flexDirection: 'row', gap: 10,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.errorRed,
    padding: 14,
  },
  exceptionBody: { flex: 1, gap: 2 },
  exceptionTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  exceptionMeta: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium },

  section: { gap: 8 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: {
    fontFamily: fonts.semibold, fontSize: FontSizes.caption, color: Colors.terracotta,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  exportLink: { fontFamily: fonts.medium, fontSize: FontSizes.caption, color: Colors.textMedium },

  reconRow: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 12, gap: 4,
  },
  reconTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  reconTitle: { flex: 1, fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  reconNet: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  reconMeta: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  reconTotalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 10, marginTop: 4,
  },
  reconTotalLabel: {
    fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: Colors.textMedium,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  reconTotalValue: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 11,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  chipsRow: { gap: 8, paddingVertical: 2 },
  chip: {
    borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
    paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: 'center',
  },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  chipTextOn: { color: Colors.white },

  purchaseRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 12, minHeight: 44,
  },
  purchaseBody: { flex: 1, gap: 2 },
  purchaseName: { fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  purchaseMeta: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  purchaseAmountWrap: { alignItems: 'flex-end', gap: 2 },
  purchaseAmount: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  purchaseStatus: { fontFamily: fonts.medium, fontSize: FontSizes.caption, color: Colors.textMedium },
  purchaseStatusMuted: { color: Colors.textLight },

  empty: {
    fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, color: Colors.textMedium,
    textAlign: 'center', paddingVertical: 12,
  },
});
