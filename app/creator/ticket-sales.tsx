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

import React, { useCallback, useMemo, useState } from 'react';
import { Share, StyleSheet, Text, TextInput, TouchableOpacity, View, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';
import { hapticLight } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import { getCreatorAccess, canManageEvents, creatorLandingRoute } from '../../lib/creatorMode';
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

type PurchaseFilter = 'all' | PurchaseStatusLabel;

const PURCHASE_FILTERS: { key: PurchaseFilter; label: string }[] = [
  { key: 'all', label: 'all' },
  { key: 'paid', label: 'paid' },
  { key: 'pending', label: 'pending' },
  { key: 'partial', label: 'partially refunded' },
  { key: 'refunded', label: 'refunded' },
  { key: 'canceled', label: 'canceled' },
];

export default function TicketSalesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<PurchaseFilter>('all');
  const [shareError, setShareError] = useState(false);

  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });

  // same queryKey tickets.tsx uses for its own event header, so arriving
  // here from that screen's "view sales" link reads a warm cache.
  const { data: event } = useQuery({
    queryKey: ['ticket-setup-event', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('explore_events')
        .select('id, title, event_date')
        .eq('id', id!)
        .maybeSingle();
      return data ?? null;
    },
    enabled: !!id,
    staleTime: 60_000,
  });

  const { data: purchases = [], isLoading } = useQuery({
    queryKey: ['event-purchases', id],
    queryFn: () => getEventPurchases(id!, event?.title ?? 'this event'),
    enabled: !!id && !!event,
    staleTime: 15_000,
  });

  const filtered = useMemo(() => {
    const searched = searchOrganizationPurchases(purchases, query);
    return statusFilter === 'all' ? searched : searched.filter((p) => purchaseStatusLabel(p) === statusFilter);
  }, [purchases, query, statusFilter]);

  // always the full set for this event, matching organizationPurchasesToCsv's
  // own established convention (payouts.tsx's identical export button)
  const handleExport = useCallback(async () => {
    if (purchases.length === 0) return;
    hapticLight();
    try {
      await Share.share({ message: organizationPurchasesToCsv(purchases) });
    } catch {
      setShareError(true);
    }
  }, [purchases]);

  if (access && !access.hasEventHostGrant && !canManageEvents(access)) {
    return <Redirect href={creatorLandingRoute(access)} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle}>ticket sales</Text>
        {purchases.length > 0 && (
          <TouchableOpacity onPress={handleExport} hitSlop={12} accessibilityRole="button" accessibilityLabel="export purchases">
            <Text style={styles.exportLink}>export</Text>
          </TouchableOpacity>
        )}
      </View>

      {!!event?.title && <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>}

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator size="small" color={Colors.terracotta} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {purchases.length > 0 && (
            <>
              <View style={styles.searchRow}>
                <Search size={16} color={Colors.textLight} strokeWidth={2.25} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="search a buyer name"
                  placeholderTextColor={Colors.textLight}
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
            /* copy to the taste gate (empty-state invitation) */
            <Text style={styles.empty}>nothing sold yet. once tickets move, purchases show up here.</Text>
          ) : filtered.length === 0 ? (
            <Text style={styles.empty}>no purchases match that search.</Text>
          ) : (
            filtered.map((p) => <PurchaseRow key={p.orderId} purchase={p} />)
          )}
        </ScrollView>
      )}

      <BrandedAlert
        visible={shareError}
        title="that did not share"
        message="give it another try in a moment."
        onClose={() => setShareError(false)}
      />
    </SafeAreaView>
  );
}

function PurchaseRow({ purchase }: { purchase: OrganizationPurchase }) {
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
          {purchase.tierName ?? 'ticket'} · {purchase.qty} {purchase.qty === 1 ? 'ticket' : 'tickets'}
        </Text>
      </View>
      <View style={styles.purchaseAmountWrap}>
        <Text style={styles.purchaseAmount}>{formatCents(purchase.totalCents)}</Text>
        <Text style={[styles.purchaseStatus, muted && styles.purchaseStatusMuted]}>{labelText}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  headerTitle: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  exportLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.textMedium },
  eventTitle: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, paddingHorizontal: 20, marginBottom: 4 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20, paddingBottom: 40, gap: 10 },
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
  empty: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium,
    textAlign: 'center', paddingVertical: 24,
  },
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
});
