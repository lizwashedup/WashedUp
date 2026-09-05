/**
 * At-a-glance attendee list (spec 100 P0 #1, native read-only slice). One row
 * per SEAT (ticket_order_positions), never per order. Search by name or
 * reference code; filter by tier and by checked-in / refunded. Counts on top.
 *
 * §7: the read is organizer-only by RLS; we show buyer_name_snapshot and the
 * seat's status, never email / phone / internal fields. §8: statuses are text +
 * icon, never colour alone; real 44pt controls; every count has a text label.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Check, ChevronDown, ChevronUp, ScanLine } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';
import { hapticLight } from '../../lib/haptics';
import { attendeesToCsv, canCurrentUserRefundEvent, executeRefund, formatCents, previewRefund } from '../../lib/ticketing';
import {
  attachAnswers,
  countAttendees,
  getEventAnswers,
  getEventAttendees,
  getEventMoneySummary,
  getEventQuestions,
  isLiveSeat,
  sumRefundedCentsOnPaidOrders,
  type DoorAttendee,
} from '../../lib/ticketAttendees';
import { MoneySummaryCard } from '../../components/creator/MoneySummaryCard';

type StatusFilter = 'all' | 'in' | 'notin' | 'refunded';

export default function AttendeesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [tier, setTier] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);

  const { data: attendees = [], isLoading } = useQuery({
    queryKey: ['event-attendees', id],
    queryFn: () => getEventAttendees(id!),
    enabled: !!id,
    staleTime: 10_000,
  });
  const { data: money } = useQuery({
    queryKey: ['event-money-summary', id],
    queryFn: () => getEventMoneySummary(id!),
    enabled: !!id,
    staleTime: 10_000,
  });
  // Safe default while loading and for anyone who isn't the exact organizer
  // identity the refund function checks (e.g. a co_leader): no button.
  const { data: canRefund = false } = useQuery({
    queryKey: ['event-refund-organizer', id],
    queryFn: () => canCurrentUserRefundEvent(id!),
    enabled: !!id,
    staleTime: 60_000,
  });

  // Screen 54 addendum: questionnaire answers, a separate read from
  // getEventAttendees above so screens that never show answers don't pay for
  // it (lib/ticketAttendees.ts). getEventAnswers only runs once there is both
  // an active question and a real order to scope it to.
  const { data: questions = [] } = useQuery({
    queryKey: ['event-questions', id],
    queryFn: () => getEventQuestions(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
  const orderIds = useMemo(() => Array.from(new Set(attendees.map((a) => a.orderId))), [attendees]);
  const orderIdsKey = orderIds.join(',');
  const { data: answerRows = [] } = useQuery({
    queryKey: ['event-answers', id, orderIdsKey],
    queryFn: () => getEventAnswers(orderIds),
    enabled: !!id && questions.length > 0 && orderIds.length > 0,
    staleTime: 10_000,
  });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleAnswers = (positionId: string) => {
    hapticLight();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(positionId)) next.delete(positionId);
      else next.add(positionId);
      return next;
    });
  };

  const counts = countAttendees(attendees);
  // Only refunds on still-'paid' orders: fully-refunded orders are already
  // excluded from gross/commission by getEventMoneySummary, so counting their
  // refunded_cents here double-subtracted them from net (see helper's doc).
  const refundedCents = useMemo(() => sumRefundedCentsOnPaidOrders(attendees), [attendees]);
  const tiers = useMemo(
    () => Array.from(new Set(attendees.map((a) => a.tierName).filter((t): t is string => !!t))),
    [attendees],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return attendees.filter((a) => {
      if (q && !a.buyerName.toLowerCase().includes(q) && !a.referenceCode.toLowerCase().includes(q)) return false;
      if (tier && a.tierName !== tier) return false;
      if (status === 'in' && !(isLiveSeat(a) && a.checkedIn)) return false;
      if (status === 'notin' && !(isLiveSeat(a) && !a.checkedIn)) return false;
      if (status === 'refunded' && !(a.refundedCents > 0 || a.voided)) return false;
      return true;
    });
  }, [attendees, query, status, tier]);

  // BR-1 attachment is pure/synchronous, so it's cheap to recompute on every
  // filter change; only the network read (answerRows) is cached/gated above.
  const filteredWithAnswers = useMemo(
    () => attachAnswers(filtered, questions, answerRows),
    [filtered, questions, answerRows],
  );

  // native's own share sheet (mail, files, Messages, etc), same real-export
  // pattern as payouts.tsx's handleExportPurchases -- BR-6: exports the
  // CURRENTLY FILTERED view, not the unfiltered attendees array.
  const handleExportAttendees = useCallback(async () => {
    if (filteredWithAnswers.length === 0) return;
    hapticLight();
    try {
      await Share.share({ message: attendeesToCsv(filteredWithAnswers, questions) });
    } catch {
      /* copy to the taste gate */
      Alert.alert('that did not share', 'give it another try in a moment.');
    }
  }, [filteredWithAnswers, questions]);

  const statusChips: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'everyone' },
    { key: 'notin', label: 'not in yet' },
    { key: 'in', label: 'checked in' },
    { key: 'refunded', label: 'refunded' },
  ];

  const seatLine = (a: DoorAttendee): string => {
    if (a.refundedCents > 0 || a.voided) return 'refunded';
    if (!isLiveSeat(a)) return a.orderStatus;
    return a.checkedIn ? 'checked in' : 'not in yet';
  };

  /**
   * Organizer refund (doc 108; web's AttendeeTable 67d5ee2 is the lockstep
   * reference): voluntary buyer_request only, per seat via 1-based
   * position_indexes or the whole remaining order. organizer_cancel is the
   * §4 cancellation slice and is deliberately NOT wired here. Amounts shown
   * come from the server preview (money is DB law), never client arithmetic.
   */
  const chooseRefund = async (a: DoorAttendee, mode: 'seat' | 'order') => {
    setRefundingId(a.positionId);
    const target = {
      kind: 'buyer_request' as const,
      positionIndexes: mode === 'seat' ? [a.positionIndex] : null,
    };
    const preview = await previewRefund(a.orderId, target);
    setRefundingId(null);
    if (!preview || !preview.allowed) {
      /* LIZ COPY (web's shipped string, mirrored) — updated 2026-09-01: "order" -> "purchase"
         per Scene handoff §14 (no backend vocab in copy); web may still say "order", check
         before assuming parity */
      Alert.alert('about that refund', "that refund isn't available for this purchase.");
      return;
    }
    Alert.alert(
      /* LIZ COPY: the previewed amount is the fact being confirmed */
      `refund ${formatCents(preview.refundAmountCents)} to the buyer?`,
      mode === 'seat' ? `this seat only, for ${a.buyerName}.` : `${a.buyerName}'s whole remaining purchase.`,
      [
        { text: 'never mind', style: 'cancel' },
        { text: 'yes, refund it', style: 'destructive', onPress: () => runRefund(a, target) },
      ],
    );
  };

  const runRefund = async (a: DoorAttendee, target: { kind: 'buyer_request'; positionIndexes: number[] | null }) => {
    setRefundingId(a.positionId);
    const outcome = await executeRefund(a.orderId, target);
    setRefundingId(null);
    if (outcome.ok) {
      queryClient.invalidateQueries({ queryKey: ['event-attendees', id] });
      queryClient.invalidateQueries({ queryKey: ['event-money-summary', id] });
      /* LIZ COPY (web's shipped strings, mirrored); pending is still success */
      Alert.alert(
        'refund sent',
        outcome.pending
          ? 'the refund went through and is finishing up. this list catches up in a minute.'
          : `refunded ${formatCents(outcome.refundAmountCents)} to the buyer.`,
      );
    } else {
      Alert.alert('about that refund', outcome.message);
    }
  };

  const startRefund = (a: DoorAttendee) => {
    hapticLight();
    Alert.alert(
      /* copy to the taste gate */
      `refund ${a.buyerName}?`,
      'the ticket price goes back to their card.',
      [
        { text: 'never mind', style: 'cancel' },
        { text: 'this seat', onPress: () => chooseRefund(a, 'seat') },
        { text: 'whole purchase', onPress: () => chooseRefund(a, 'order') },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle}>who's coming</Text>
        <TouchableOpacity onPress={() => { hapticLight(); router.push(`/creator/check-in?id=${id}` as never); }} hitSlop={12} accessibilityRole="button" accessibilityLabel="open check-in">
          <ScanLine size={20} color={Colors.terracotta} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {/* counts, each with its own text label (§8) */}
      <View style={styles.countsRow}>
        <View style={styles.countCell}>
          <Text style={styles.countN}>{counts.sold}</Text>
          <Text style={styles.countL}>sold</Text>
        </View>
        <View style={styles.countCell}>
          <Text style={styles.countN}>{counts.checkedIn}</Text>
          <Text style={styles.countL}>checked in</Text>
        </View>
        <View style={styles.countCell}>
          <Text style={styles.countN}>{counts.refunded}</Text>
          <Text style={styles.countL}>refunded</Text>
        </View>
      </View>

      {money && (
        <MoneySummaryCard money={money} ticketsSold={counts.sold} refundedCents={refundedCents} />
      )}

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="search a name or code"
        placeholderTextColor={Colors.textLight}
        autoCorrect={false}
        accessibilityLabel="search attendees by name or reference code"
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {statusChips.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.chip, status === c.key && styles.chipOn]}
            onPress={() => { hapticLight(); setStatus(c.key); }}
            accessibilityRole="button"
            accessibilityState={{ selected: status === c.key }}
          >
            <Text style={[styles.chipText, status === c.key && styles.chipTextOn]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
        {tiers.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.chip, tier === t && styles.chipOn]}
            onPress={() => { hapticLight(); setTier(tier === t ? null : t); }}
            accessibilityRole="button"
            accessibilityState={{ selected: tier === t }}
          >
            <Text style={[styles.chipText, tier === t && styles.chipTextOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {filtered.length > 0 && (
        <View style={styles.exportRow}>
          <TouchableOpacity onPress={handleExportAttendees} hitSlop={12} accessibilityRole="button" accessibilityLabel="export attendees">
            {/* LIZ COPY */}
            <Text style={styles.exportLink}>export</Text>
          </TouchableOpacity>
        </View>
      )}

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={Colors.terracotta} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {filteredWithAnswers.length === 0 ? (
            /* copy to the taste gate (empty-state) */
            <Text style={styles.empty}>no one here yet.</Text>
          ) : (
            filteredWithAnswers.map((a) => {
              const line = seatLine(a);
              const isIn = isLiveSeat(a) && a.checkedIn;
              const isRefunded = a.refundedCents > 0 || a.voided;
              const hasAnswers = questions.length > 0;
              const isExpanded = expandedIds.has(a.positionId);
              return (
                <View key={a.positionId} style={styles.rowGroup}>
                  <View style={styles.row}>
                    {hasAnswers && (
                      <TouchableOpacity
                        onPress={() => toggleAnswers(a.positionId)}
                        hitSlop={12}
                        accessibilityRole="button"
                        accessibilityLabel={isExpanded ? `hide answers for ${a.buyerName}` : `show answers for ${a.buyerName}`}
                        accessibilityState={{ expanded: isExpanded }}
                      >
                        {isExpanded ? (
                          <ChevronUp size={16} color={Colors.textMedium} strokeWidth={2} />
                        ) : (
                          <ChevronDown size={16} color={Colors.textMedium} strokeWidth={2} />
                        )}
                      </TouchableOpacity>
                    )}
                    <View style={styles.rowBody}>
                      <Text style={styles.rowName} numberOfLines={1}>{a.buyerName}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {a.referenceCode}{a.tierName ? ` · ${a.tierName}` : ''}
                      </Text>
                    </View>
                    {/* status: icon + text, never colour alone (§8) */}
                    <View style={styles.statusWrap}>
                      {isIn && <Check size={15} color={Colors.brandDeep} strokeWidth={2.5} />}
                      {isRefunded && <Ban size={14} color={Colors.textMedium} strokeWidth={2} />}
                      <Text style={[styles.statusText, isIn && styles.statusIn, isRefunded && styles.statusRefunded]}>
                        {line}
                      </Text>
                    </View>
                    {/* refund lives on live seats only, for the real organizer only; the fn re-checks server-side */}
                    {isLiveSeat(a) && canRefund && (
                      <TouchableOpacity
                        style={styles.refundPill}
                        onPress={() => startRefund(a)}
                        disabled={refundingId != null}
                        accessibilityRole="button"
                        accessibilityLabel={`refund ${a.buyerName}`}
                      >
                        {refundingId === a.positionId ? (
                          <ActivityIndicator size="small" color={Colors.darkWarm} />
                        ) : (
                          /* copy to the taste gate */
                          <Text style={styles.refundPillText}>refund</Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                  {isExpanded && hasAnswers && (
                    <View style={styles.answersPanel}>
                      {questions.map((q) => (
                        <View key={q.id} style={styles.answerItem}>
                          <Text style={styles.answerPrompt}>
                            {q.prompt}{q.scope === 'per_order' ? ' · once per purchase' : ''}
                          </Text>
                          <Text style={styles.answerValue}>{a.answers[q.id] || '—'}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  headerTitle: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  countsRow: { flexDirection: 'row', paddingHorizontal: 20, paddingBottom: EventSpacing.sm, gap: EventSpacing.md },
  countCell: { flex: 1, backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, paddingVertical: 10, alignItems: 'center' },
  countN: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  countL: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.textMedium, textTransform: 'uppercase', letterSpacing: 0.5 },
  search: {
    marginHorizontal: 20, marginBottom: EventSpacing.sm,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 11,
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt,
  },
  chipsRow: { paddingHorizontal: 20, gap: 8, paddingBottom: EventSpacing.sm },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white, paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: 'center' },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  chipTextOn: { color: Colors.white },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 8 },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center', marginTop: EventSpacing.xl },
  exportRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingBottom: EventSpacing.sm },
  exportLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.textMedium },
  rowGroup: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12, minHeight: 44,
  },
  rowBody: { flex: 1, gap: 2 },
  answersPanel: {
    borderTopWidth: 1, borderTopColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 12, gap: 10,
  },
  answerItem: { gap: 2 },
  answerPrompt: {
    fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.textMedium, letterSpacing: 0.3,
  },
  answerValue: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  rowName: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  rowMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, letterSpacing: 0.3 },
  statusWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  statusIn: { color: Colors.brandDeep },
  statusRefunded: { color: Colors.textMedium },
  refundPill: {
    // §8: real 44pt controls, no undersized tap targets
    minHeight: 44, minWidth: 64, borderRadius: 999, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center',
  },
  refundPillText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
});
