/**
 * Ticket sales operations (Build 35 Screen 44): this ONE event's purchases,
 * separated out from ticket TYPE setup (tickets.tsx) per the matrix's own
 * instruction -- "separate setup from operations rather than growing
 * tickets.tsx past 38K." Reached from tickets.tsx's own header ("view sales"
 * link), the one file this cluster owns that every ticketed event already
 * visits.
 *
 * Search, status filter, and CSV export are the SAME functions Screen 10's
 * organization-wide ledger already ships (searchOrganizationPurchases,
 * purchaseStatusLabel, organizationPurchasesToCsv) against
 * getEventPurchases -- a per-event lens on the identical OrganizationPurchase
 * row, not a second implementation to keep in sync.
 *
 * "answer review" (the matrix's other named gap for this screen) is not
 * duplicated here: tapping a purchase opens Screen 45
 * (app/creator/purchase/[id].tsx), which already renders every seat's
 * answers against this event's active questions. Building a second answers
 * reader inside this list would be exactly the "second question system" this
 * codebase's own Screen 24 note warns against.
 *
 * "dispute states" (also named in the matrix) is deliberately not attempted:
 * purchaseStatusLabel's own doc comment already establishes there is no
 * failed/disputed/chargeback order status in the live CHECK constraint
 * (pending/paid/canceled/refunded) -- inventing one here would contradict
 * that established precedent in the same file this screen imports from.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Share, StyleSheet, Text, TextInput, TouchableOpacity, View, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Download, Search } from 'lucide-react-native';
import Colors, { AfterglowColors as C, CreatorSurfaceColors } from '../../constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import ProfileButton from '../../components/ProfileButton';
import { CreatorActionFill } from '../../components/creator/CreatorActionFill';
import { FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { hapticLight } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { canReadCreatorTickets, scopedTicketRequest } from '../../lib/creatorTicketRead';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { PageAction, PageFrame } from '../../components/creator/pages/PageFrame';
import {
  formatCents,
  getEventPurchases,
  organizationPurchasesToCsv,
  purchaseStatusLabel,
  searchOrganizationPurchases,
  type OrganizationPurchase,
  type PurchaseStatusLabel,
} from '../../lib/ticketing';
import { BrandedAlert } from '../../components/BrandedAlert';

import { requestWithDeadline } from '../../lib/requestWithDeadline';

let nextSalesVisit = 0;
class SalesAccessUnavailable extends Error {}
async function boundedRead<T>(scope: CreatorPageScope, read: (owned: CreatorPageScope) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let reading = true;
  const owned = { userId: scope.userId, isCurrent: () => reading && !signal?.aborted && scope.isCurrent() };
  try {
    if (!owned.isCurrent()) throw new Error('This visit has ended.');
    const result = await requestWithDeadline(read(owned), 12_000);
    if (!owned.isCurrent()) throw new Error('This visit has ended.');
    return result;
  } finally { reading = false; }
}

type PurchaseFilter = 'all' | PurchaseStatusLabel;

const PURCHASE_FILTERS: { key: PurchaseFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'paid', label: 'Paid' },
  { key: 'pending', label: 'Pending' },
  { key: 'partial', label: 'Partially refunded' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'canceled', label: 'Canceled' },
];

export default function TicketSalesScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { scope, account } = useCreatorPageScope(id ?? '');
  const visit = useMemo(() => ++nextSalesVisit, [scope, id]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const accessRetryLock = useRef(false);
  const validId = typeof id === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
  const read = useCallback((scope: CreatorPageScope) => boundedRead(scope, async owned => {
    // Same event-specific financial authority as ticket setup and purchase details.
    if (!await canReadCreatorTickets(id!, owned)) return null;
    const { data, error } = await scopedTicketRequest(owned, () => supabase
      .from('explore_events').select('id, title, event_date').eq('id', id!).maybeSingle());
    if (error || !data || data.id !== id) throw new Error('Event details could not be loaded.');
    return data;
  }), [id]);
  const result = useCreatorPageRead(validId ? scope : null, read);
  const identity = `${account?.epoch ?? ''}:${scope?.userId ?? ''}:${id}:${visit}`;
  const admitted = useRef<string | null>(null);
  if (result.data && !result.error) admitted.current = identity;
  if (result.data === null) admitted.current = null;
  const active = !!scope?.isCurrent() && !!result.data && !result.loading && !result.error;
  const retryAccess = () => {
    if (!mounted.current || accessRetryLock.current || !(scope?.isCurrent() ?? account?.isCurrent())) return;
    accessRetryLock.current = true;
    void (account?.error ? account.retry() : result.refresh()).catch(() => undefined).finally(() => { accessRetryLock.current = false; });
  };
  return <>
    {scope && admitted.current === identity && <View style={{flex:1,display:active?'flex':'none'}}>
      <TicketSalesContent key={identity} id={id!} scope={scope} visit={visit} active={active} eventTitle={result.data?.title ?? ''}/>
    </View>}
    {!active && <PageFrame title="Ticket sales">
      {account?.isLoading || result.loading ? <ActivityIndicator accessibilityLabel="Checking sales access" color={Colors.terracotta}/> : <>
        <Text style={styles.empty}>{result.error || account?.error ? 'Ticket sales couldn’t be loaded.' : 'Ticket sales aren’t available for this event and account.'}</Text>
        {validId && <PageAction title="Try again" compact onPress={retryAccess}/>}
      </>}
    </PageFrame>}
  </>;
}

function TicketSalesContent({id,scope: incomingScope,visit,active,eventTitle}:{id:string;scope:CreatorPageScope;visit:number;active:boolean;eventTitle:string}) {
  const mounted = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const scope = useMemo(() => ({ userId: incomingScope.userId, isCurrent: () => mounted.current && activeRef.current && incomingScope.isCurrent() }), [incomingScope]);
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<PurchaseFilter>('all');
  const [shareError, setShareError] = useState(false);
  const exportLock = useRef(false);
  const [exporting, setExporting] = useState(false);
  const { data: purchaseData, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ['event-purchases', id, scope.userId, visit],
    queryFn: ({ signal }) => boundedRead(scope, async owned => {
      if (!await canReadCreatorTickets(id, owned)) throw new SalesAccessUnavailable('Sales access is no longer available.');
      if (!owned.isCurrent()) throw new Error('This visit has ended.');
      return getEventPurchases(id, eventTitle, owned);
    }, signal),
    retry: false,
    enabled: active,
    staleTime: 15_000,
  });

  const purchases = purchaseData ?? [];
  const accessDenied = error instanceof SalesAccessUnavailable;
  const readyRef = useRef(false);
  readyRef.current = active && purchaseData !== undefined && !isError && !isFetching;
  const retryLock = useRef(false);
  const [retrying, setRetrying] = useState(false);
  const retryPurchases = () => {
    if (!scope.isCurrent() || retryLock.current || isFetching) return;
    retryLock.current = true;
    setRetrying(true);
    void refetch({ cancelRefetch: false }).catch(() => undefined).finally(() => {
      retryLock.current = false;
      if (scope.isCurrent()) setRetrying(false);
    });
  };

  const filtered = useMemo(() => {
    const searched = searchOrganizationPurchases(purchases, query);
    return statusFilter === 'all' ? searched : searched.filter((p) => purchaseStatusLabel(p) === statusFilter);
  }, [purchases, query, statusFilter]);

  // always the full set for this event, matching organizationPurchasesToCsv's
  // own established convention (payouts.tsx's identical export button)
  const handleExport = useCallback(async () => {
    if (!scope.isCurrent() || !readyRef.current || exportLock.current || purchases.length === 0) return;
    exportLock.current = true;
    setExporting(true);
    hapticLight();
    try {
      const fresh = await refetch({ cancelRefetch: false });
      if (fresh.isError) throw new Error('Sales could not be refreshed.');
      if (!scope.isCurrent() || !fresh.data?.length) return;
      await Share.share({ message: organizationPurchasesToCsv(fresh.data) });
    } catch {
      if (scope.isCurrent()) setShareError(true);
    } finally {
      exportLock.current = false;
      if (scope.isCurrent()) setExporting(false);
    }
  }, [purchases, active, scope, isError, isLoading, refetch]);


  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { if(!active || !scope.isCurrent()) return; if(router.canGoBack()) router.back(); else router.replace(`/creator/tickets?id=${id}` as never); }} style={styles.headerControl} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Ticket sales</Text>
        <ProfileButton compact />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {!!eventTitle && <View style={styles.eventContext}>
          <LinearGradient pointerEvents="none" colors={[CreatorSurfaceColors.sunsetGoldLight, C.white]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <Text style={styles.eventEyebrow}>Event</Text>
          <Text style={styles.eventTitle}>{eventTitle}</Text>
        </View>}

        <View style={styles.listHeading}>
          <Text style={styles.sectionTitle}>Purchases</Text>
          {!isError && !isLoading && purchases.length > 0 && (
            <TouchableOpacity onPress={handleExport} disabled={exporting || isFetching} accessibilityState={{disabled:exporting || isFetching,busy:exporting || isFetching}} style={[styles.exportControl, (exporting || isFetching) && styles.disabledAction]} accessibilityRole="button" accessibilityLabel="export purchases">
              <CreatorActionFill />
              <Download size={16} color={Colors.white} />
              <Text numberOfLines={1} style={styles.exportLink}>{exporting ? 'Preparing…' : 'Export'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {(isError || retrying || (isFetching && purchaseData !== undefined && !exporting)) && <View style={styles.readNotice} accessibilityRole="alert">
          <Text style={styles.readNoticeText}>{isFetching
            ? 'Checking the latest sales.'
            : accessDenied ? 'Sales access is no longer available. Try again to check access.'
            : purchaseData === undefined ? 'Purchases couldn’t be loaded. Try again to see your sales.'
            : 'Purchases couldn’t be refreshed. Your last loaded sales are shown.'}</Text>
          {isError || retrying
            ? <PageAction title={isFetching ? 'Retrying…' : 'Try again'} compact singleLine disabled={isFetching} onPress={retryPurchases}/>
            : <ActivityIndicator accessibilityLabel="Refreshing purchases" size="small" color={Colors.terracotta} />}
        </View>}

        {isLoading ? (
          !retrying && <View style={styles.loading}><ActivityIndicator accessibilityLabel="Loading purchases" size="small" color={Colors.terracotta} /></View>
        ) : purchaseData === undefined || accessDenied ? null : <>
          {purchases.length > 0 && <>
            <View style={styles.searchRow}>
              <Search size={18} color={C.muted} strokeWidth={2} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search a buyer name"
                placeholderTextColor={C.muted}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="search purchases by buyer name"
              />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {PURCHASE_FILTERS.map((f) => (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.chip, statusFilter === f.key && styles.chipOn]}
                  onPress={() => { if (!scope.isCurrent()) return; hapticLight(); setStatusFilter(f.key); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: statusFilter === f.key }}
                >
                  {statusFilter === f.key && <CreatorActionFill />}
                  <Text numberOfLines={1} style={[styles.chipText, statusFilter === f.key && styles.chipTextOn]}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>}

          {purchases.length === 0 ? (
            <Text style={styles.empty}>Your purchases will appear here as people book tickets.</Text>
          ) : filtered.length === 0 ? (
            <Text style={styles.empty}>No purchases match this search.</Text>
          ) : filtered.map((p) => <PurchaseRow key={p.orderId} purchase={p} disabled={!active || isError || isFetching} open={() => { if(scope.isCurrent() && readyRef.current) { hapticLight(); router.push(`/creator/purchase/${p.orderId}` as never); } }} />)}
        </>}
      </ScrollView>

      <BrandedAlert
        visible={shareError}
        title="Couldn’t share"
        message="Try again in a moment."
        onClose={() => { if (scope.isCurrent()) setShareError(false); }}
      />
    </SafeAreaView>
  );
}

function PurchaseRow({ purchase, open, disabled }: { purchase: OrganizationPurchase; open():void; disabled: boolean }) {
  const styles = useStyles();
  const label = purchaseStatusLabel(purchase);
  const labelText = label === 'partial' ? 'Partially refunded' : label.charAt(0).toUpperCase() + label.slice(1);
  const muted = label === 'refunded' || label === 'partial' || label === 'canceled';
  return (
    <TouchableOpacity
      style={styles.purchaseRow}
      onPress={open}
      disabled={disabled}
      accessibilityState={{ disabled }}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`open purchase by ${purchase.buyerName}`}
    >
      <View style={styles.purchaseHeading}>
        <View style={styles.purchaseBody}>
          <Text style={styles.purchaseName}>{purchase.buyerName}</Text>
          <Text style={styles.purchaseMeta}>
            {purchase.tierName ?? 'Ticket'} · {purchase.qty} {purchase.qty === 1 ? 'ticket' : 'tickets'}
          </Text>
        </View>
        <ChevronRight size={18} color={C.muted} />
      </View>
      <View style={styles.purchaseAmountWrap}>
        <Text style={styles.purchaseAmount}>{formatCents(purchase.totalCents)}</Text>
        <View style={styles.statusPill}><Text style={[styles.purchaseStatus, muted && styles.purchaseStatusMuted]}>{labelText}</Text></View>
      </View>
    </TouchableOpacity>
  );
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  readNotice: { padding: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, backgroundColor: C.white, borderWidth: 1, borderColor: CreatorSurfaceColors.goldEdge, borderRadius: 14 },
  readNoticeText: { flexGrow: 1, flexBasis: 120, minWidth: 0, fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: C.muted },
  container: { flex: 1, backgroundColor: C.paper },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 56, gap: 12 },
  headerControl: {minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'},
  headerTitle: { flex: 1, minWidth: 0, fontFamily: fonts.medium, fontSize: FontSizes.bodyLG, color: C.ink },
  exportControl: { minHeight: 44, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 24, borderWidth: 1, borderColor: CreatorSurfaceColors.goldEdge, backgroundColor: Colors.terracotta },
  exportLink: { flexShrink: 1, fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.white },
  disabledAction: { opacity: 0.55 },
  eventContext: { padding: 16, gap: 6, borderRadius: 16, borderWidth: 1, borderColor: CreatorSurfaceColors.goldEdge, overflow: 'hidden' },
  eventEyebrow: { fontFamily: fonts.medium, fontSize: FontSizes.caption, color: C.muted },
  eventTitle: { fontFamily: fonts.display, fontSize: FontSizes.displayMD, lineHeight: 32, color: C.ink },
  listHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: C.ink },
  loading: { paddingVertical: 32, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, gap: 12 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.white, borderRadius: 14, borderWidth: 1, borderColor: C.subtleLine,
    paddingHorizontal: 14, paddingVertical: 12, minHeight: 48,
  },
  searchInput: { flex: 1, minWidth: 0, padding: 0, fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  chipsRow: { gap: 8, paddingVertical: 2 },
  chip: {
    borderRadius: 24, borderWidth: 1, borderColor: C.subtleLine, backgroundColor: C.white,
    paddingHorizontal: 14, paddingVertical: 8, minHeight: 44, justifyContent: 'center',
  },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: CreatorSurfaceColors.goldEdge },
  chipText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: C.ink },
  chipTextOn: { color: Colors.white },
  empty: {
    fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, color: Colors.textMedium,
    textAlign: 'center', paddingVertical: 24,
  },
  purchaseRow: {
    flexDirection: 'column', alignItems: 'stretch', gap: 12,
    backgroundColor: C.white, borderRadius: 16, borderWidth: 1, borderColor: C.subtleLine,
    padding: 16, minHeight: 44,
    shadowColor: Colors.darkWarm, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.035, shadowRadius: 6,
  },
  purchaseHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  purchaseBody: { flex: 1, minWidth: 0, gap: 6 },
  purchaseName: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: C.ink },
  purchaseMeta: { lineHeight:20, fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: C.muted },
  purchaseAmountWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.subtleLine, paddingTop: 10 },
  purchaseAmount: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: C.ink },
  statusPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: CreatorSurfaceColors.goldLight, maxWidth: '100%' },
  purchaseStatus: { fontFamily: fonts.medium, fontSize: FontSizes.caption, color: C.muted },
  purchaseStatusMuted: { color: C.muted },
}); }
function useStyles() { const {fonts}=useAfterglowFonts(true, 'creator'); return useMemo(()=>createStyles(fonts),[fonts]); }
