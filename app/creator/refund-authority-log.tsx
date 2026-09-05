/**
 * Refund issuance log (Liz decision #14, 2026-09-03): who issued each refund
 * on this community's events, whether they were the owner or a granted
 * delegate, the amount, the reason (mandatory for a delegate), the date, and
 * the affected order. Read-only -- all mutation happens through
 * supabase/functions/ticket-refund/index.ts, never from this screen.
 *
 * Behind REFUND_AUTHORITY_ENABLED (constants/FeatureFlags.ts), off by
 * default. Visibility is whatever this viewer's RLS on refund_issuance_log
 * allows (refund_authority_grants_select's issuance-log sibling policy): the
 * real owner sees every refund on the community's events, a delegate sees
 * only refunds they themselves issued. The copy below says so -- this screen
 * never claims a wider view than what actually renders.
 */

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack, Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { REFUND_AUTHORITY_ENABLED } from '../../constants/FeatureFlags';
import { getCreatorAccess, isLeaderAccess } from '../../lib/creatorMode';
import { useLedCommunity } from '../../lib/selectedCommunity';
import {
  listCommunityRefundIssuanceLog,
  formatRefundAmount,
  refundKindLabel,
  type RefundIssuanceLogRow,
} from '../../lib/refundAuthority';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ticketLabel(row: RefundIssuanceLogRow): string {
  const count = row.positionIndexes?.length ?? 0;
  if (count === 0) return 'whole order';
  if (count === 1) return `ticket #${row.positionIndexes![0]}`;
  return `${count} tickets`;
}

export default function RefundAuthorityLogScreen() {
  const router = useRouter();
  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const community = useLedCommunity(access);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['refund-issuance-log', community?.id],
    queryFn: () => listCommunityRefundIssuanceLog(community!.id),
    enabled: !!community && REFUND_AUTHORITY_ENABLED,
  });

  if (!REFUND_AUTHORITY_ENABLED) return <Redirect href="/creator/co-creators" />;
  if (access && !isLeaderAccess(access)) return <Redirect href="/(creator)/events" />;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.text1} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {!community ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Refund history</Text>
          <Text style={styles.hint}>
            Every refund issued on {community.name}&apos;s events that you have visibility into. As the
            primary creator you see all of them; a co-creator with refund authority sees only the ones
            they issued themselves.
          </Text>

          {isLoading ? (
            <ActivityIndicator size="small" color={Colors.terracotta} style={{ marginTop: 24 }} />
          ) : rows.length === 0 ? (
            <Text style={styles.hint}>No refunds have been issued yet.</Text>
          ) : (
            rows.map((row) => (
              <View key={row.id} style={styles.logCard}>
                <View style={styles.logCardHeaderRow}>
                  <Text style={styles.logAmount}>{formatRefundAmount(row.refundAmountCents)}</Text>
                  <Text style={styles.logDate}>{formatDate(row.createdAt)}</Text>
                </View>
                <Text style={styles.logEvent}>{row.eventTitle ?? 'An event'} · {ticketLabel(row)}</Text>
                <Text style={styles.logIssuer}>
                  {refundKindLabel(row.kind)} issued by {row.issuedByName ?? 'someone'}
                  {row.issuerIsOwner ? ' (owner)' : ' (refund delegate)'}
                </Text>
                {row.reason ? <Text style={styles.logReason}>&quot;{row.reason}&quot;</Text> : null}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  headerBtn: { padding: 4 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 48 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.text1,
    marginBottom: 8,
  },
  hint: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.text2, lineHeight: LineHeights.bodySM, marginBottom: 20 },
  logCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    padding: 14,
    marginBottom: 8,
    gap: 4,
  },
  logCardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logAmount: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.text1 },
  logDate: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.text3 },
  logEvent: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.text1 },
  logIssuer: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.text3 },
  logReason: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.text2, fontStyle: 'italic', marginTop: 2 },
});
