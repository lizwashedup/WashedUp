/**
 * Purchase detail (Build 35 Screen 45): the per-purchase drill-down the
 * matrix names as the real remaining gap once Screens 10/44 exist -- both of
 * those already leave their purchase rows tappable/inert pointing here (see
 * app/creator/payouts.tsx and app/creator/ticket-sales.tsx's own headers).
 * Route: creator/payouts + creator/ticket-sales -> select purchase.
 *
 * Reuses existing, already-shipped reads/writes only -- no new table, no new
 * RPC, no new edge-function call:
 *   - order-level facts: getPurchaseDetail (lib/ticketing.ts)
 *   - seat-level facts: getEventAttendees, filtered to this order (the SAME
 *     query the Attendees screen/check-in screen already run and cache
 *     under ['event-attendees', eventId] -- this screen invalidates that
 *     exact key on refund so Attendees never goes stale behind it)
 *   - answers: getEventQuestions/getEventAnswers/attachAnswers (Screen 54's
 *     own reader), scoped to just this order's rows
 *   - refund: previewRefund/executeRefund/getRefundAccess, the
 *     exact functions attendees.tsx already calls -- this screen does not
 *     touch the ticket-refund edge function or refund_authority in any way.
 *
 * Consequence disclosure (the named gap: "cannot sit behind generic 'are you
 * sure' copy"): every fact stated below is one this codebase already proves
 * elsewhere, not invented for this screen -- the amount and seat count come
 * from the server's own previewRefund answer (never client math), the
 * processing-fee line is REFUND_DISCLOSURE (Liz-ruled copy, verbatim,
 * already shown to buyers), and "this ticket can no longer check in" mirrors
 * check-in.tsx's own outcomeToVerdict, which already renders a refunded/
 * voided seat as a hard fail at the door.
 *
 * Audit trail -- NOT built here, flagged rather than faked: ticket_orders
 * carries no refunded_at/refunded_by column and there is no ticket_orders
 * change-log table anywhere in this repo's tracked migrations (grepped
 * clean), so there is nothing truthful to show beyond "refunded_cents is
 * currently > 0". A real action-level trail (who refunded how much, when)
 * needs its own additive migration -- event-money.tsx's own header already
 * names this as separate, unbuilt scope. Writing that migration blind, with
 * no live Supabase connection this session to confirm ticket_orders' full
 * column set, any existing trigger, or grants on a new table, is exactly the
 * unverified-schema-change shape this project's Release Discipline rule
 * exists to prevent (the 2026-08-31 OTP regression). Left for a session with
 * real DB access. What IS shown below is every real, already-tracked fact:
 * purchase time and each seat's own check-in time.
 */

import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Clock, TriangleAlert } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { EventAction, EventSpacing } from '../../../constants/EventDesign';
import { hapticLight } from '../../../lib/haptics';
import { formatTimestampLA } from '../../../lib/laDate';
import {
  executeRefund,
  formatCents,
  getPurchaseDetail,
  getRefundAccess,
  previewRefund,
  purchaseStatusLabel,
  REFUND_DISCLOSURE,
  type RefundTarget,
} from '../../../lib/ticketing';
import { RefundReasonModal } from '../../../components/creator/RefundReasonModal';
import {
  attachAnswers,
  answerToString,
  getEventAnswers,
  getEventAttendees,
  getEventQuestions,
  isLiveSeat,
} from '../../../lib/ticketAttendees';
import { BrandedAlert, type BrandedAlertButton } from '../../../components/BrandedAlert';

export default function PurchaseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [refunding, setRefunding] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: purchase, isLoading: purchaseLoading } = useQuery({
    queryKey: ['purchase-detail', id],
    queryFn: () => getPurchaseDetail(id!),
    enabled: !!id,
    staleTime: 10_000,
  });
  const eventId = purchase?.eventId ?? null;

  const { data: attendees = [] } = useQuery({
    queryKey: ['event-attendees', eventId],
    queryFn: () => getEventAttendees(eventId!),
    enabled: !!eventId,
    staleTime: 10_000,
  });
  const seats = useMemo(() => attendees.filter((a) => a.orderId === id), [attendees, id]);

  const { data: questions = [] } = useQuery({
    queryKey: ['event-questions', eventId],
    queryFn: () => getEventQuestions(eventId!),
    enabled: !!eventId,
    staleTime: 30_000,
  });
  const { data: answerRows = [] } = useQuery({
    queryKey: ['event-answers', eventId, id],
    queryFn: () => getEventAnswers([id!]),
    enabled: !!eventId && !!id && questions.length > 0,
    staleTime: 10_000,
  });
  const seatsWithAnswers = useMemo(() => attachAnswers(seats, questions, answerRows), [seats, questions, answerRows]);

  const { data: refundAccess } = useQuery({
    queryKey: ['event-refund-access', eventId],
    queryFn: () => getRefundAccess(eventId!),
    enabled: !!eventId,
    staleTime: 60_000,
  });
  const canRefund = refundAccess?.canRefund ?? false;
  const isRefundDelegate = refundAccess?.isDelegate ?? false;

  const invalidateAfterRefund = () => {
    queryClient.invalidateQueries({ queryKey: ['purchase-detail', id] });
    if (eventId) {
      queryClient.invalidateQueries({ queryKey: ['event-attendees', eventId] });
      queryClient.invalidateQueries({ queryKey: ['event-money-summary', eventId] });
    }
    queryClient.invalidateQueries({ queryKey: ['ledger-purchases'] });
    queryClient.invalidateQueries({ queryKey: ['ledger-reconciliation'] });
  };

  // Delegate-only reason step (Liz's item 14): opened from confirmRefund
  // below once the preview confirms the refund is allowed.
  const [reasonModal, setReasonModal] = useState<{
    positionIndexes: number[] | null;
    amountLabel: string;
    scopeLabel: string;
  } | null>(null);

  const runRefund = async (positionIndexes: number[] | null, reason?: string) => {
    if (!id) return;
    setRefunding(true);
    const target: RefundTarget = { kind: 'buyer_request', positionIndexes };
    if (reason) target.reason = reason;
    const outcome = await executeRefund(id, target);
    setRefunding(false);
    if (outcome.ok) {
      invalidateAfterRefund();
      /* LIZ COPY (attendees.tsx's shipped strings, mirrored) */
      setAlertInfo({
        title: 'refund sent',
        message: outcome.pending
          ? 'the refund went through and is finishing up. this page catches up in a minute.'
          : `refunded ${formatCents(outcome.refundAmountCents)} to the buyer.`,
      });
    } else {
      setAlertInfo({ title: 'about that refund', message: outcome.message });
    }
  };

  const submitReasonRefund = async (reason: string) => {
    if (!reasonModal) return;
    const { positionIndexes } = reasonModal;
    setReasonModal(null);
    await runRefund(positionIndexes, reason);
  };

  const confirmRefund = async (positionIndexes: number[] | null, scopeLabel: string) => {
    if (!id) return;
    setRefunding(true);
    const preview = await previewRefund(id, { kind: 'buyer_request', positionIndexes });
    setRefunding(false);
    if (!preview || !preview.allowed) {
      setAlertInfo({ title: 'about that refund', message: "that refund isn't available for this purchase." });
      return;
    }
    hapticLight();
    // A granted delegate (not the owner) must supply a reason -- the edge
    // function and record_refund_issuance both require it, and the owner is
    // never asked. See RefundReasonModal.
    if (isRefundDelegate) {
      setReasonModal({
        positionIndexes,
        amountLabel: formatCents(preview.refundAmountCents),
        scopeLabel: `${scopeLabel} ${preview.positionCount === 1 ? 'this ticket becomes' : `these ${preview.positionCount} tickets become`} invalid immediately and can no longer check in. ${REFUND_DISCLOSURE}`,
      });
      return;
    }
    Alert.alert(
      /* copy to the taste gate: every consequence named, not a bare "are you sure" */
      `refund ${formatCents(preview.refundAmountCents)}?`,
      `${scopeLabel} ${preview.positionCount === 1 ? 'this ticket becomes' : `these ${preview.positionCount} tickets become`} invalid immediately and can no longer check in. ${REFUND_DISCLOSURE}`,
      [
        { text: 'never mind', style: 'cancel' },
        { text: 'refund it', style: 'destructive', onPress: () => runRefund(positionIndexes) },
      ],
    );
  };

  if (purchaseLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}><ActivityIndicator size="large" color={Colors.terracotta} /></View>
      </SafeAreaView>
    );
  }

  if (!purchase) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="back">
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          {/* copy to the taste gate */}
          <Text style={styles.empty}>couldn&apos;t find that purchase.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const label = purchaseStatusLabel(purchase);
  const canOfferRefund = canRefund && purchase.status === 'paid' && purchase.refundedCents < purchase.totalCents;
  const liveSeats = seats.filter(isLiveSeat);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle} numberOfLines={1}>{purchase.buyerName}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Text style={styles.statusPill}>{label === 'partial' ? 'partially refunded' : label}</Text>
          <Text style={styles.eventTitle} numberOfLines={2}>{purchase.eventTitle}</Text>
          <Text style={styles.metaLine}>
            {purchase.tierName ?? 'ticket'} · {purchase.qty} {purchase.qty === 1 ? 'ticket' : 'tickets'}
          </Text>
          <Text style={styles.metaLine}>purchased {formatTimestampLA(purchase.createdAt)}</Text>
          <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>total</Text>
            <Text style={styles.amountValue}>{formatCents(purchase.totalCents)}</Text>
          </View>
          {purchase.refundedCents > 0 && (
            <View style={styles.amountRow}>
              {/* copy to the taste gate */}
              <Text style={styles.amountLabel}>refunded so far</Text>
              <Text style={styles.amountValueMuted}>{formatCents(purchase.refundedCents)}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          {/* copy to the taste gate */}
          <Text style={styles.sectionLabel}>tickets on this purchase</Text>
          {seatsWithAnswers.map((seat) => (
            <View key={seat.positionId} style={styles.seatRow}>
              <View style={styles.seatIcon}>
                {seat.voided || seat.refundedCents > 0 ? (
                  <TriangleAlert size={16} color={EventAction.error} strokeWidth={2} />
                ) : seat.checkedIn ? (
                  <Check size={16} color={Colors.brandDeep} strokeWidth={2.5} />
                ) : (
                  <Clock size={16} color={Colors.textLight} strokeWidth={2} />
                )}
              </View>
              <View style={styles.seatBody}>
                <Text style={styles.seatCode}>{seat.referenceCode}</Text>
                <Text style={styles.seatState}>
                  {seat.voided || seat.refundedCents > 0
                    ? 'refunded'
                    : seat.checkedIn
                      ? `checked in ${seat.checkedInAt ? formatTimestampLA(seat.checkedInAt) : ''}`
                      : 'not checked in yet'}
                </Text>
                {questions.map((q) => {
                  const raw = seat.answers[q.id];
                  if (!raw) return null;
                  return (
                    <Text key={q.id} style={styles.answerLine} numberOfLines={2}>
                      {q.prompt}: {raw}
                    </Text>
                  );
                })}
              </View>
            </View>
          ))}
        </View>

        {canOfferRefund && (
          <View style={styles.section}>
            {/* copy to the taste gate */}
            <Text style={styles.sectionLabel}>refund</Text>
            <View style={styles.disclosureCard}>
              {/* every consequence named before any action is offered */}
              <Text style={styles.disclosureLine}>the ticket price goes back to the buyer&apos;s card.</Text>
              <Text style={styles.disclosureLine}>{REFUND_DISCLOSURE}</Text>
              <Text style={styles.disclosureLine}>a refunded ticket can no longer check in at the door.</Text>
            </View>
            {liveSeats.length > 1 ? (
              <>
                <TouchableOpacity
                  style={[styles.refundBtn, refunding && styles.refundBtnOff]}
                  onPress={() => confirmRefund(null, "the buyer's whole remaining purchase --")}
                  disabled={refunding}
                  activeOpacity={0.85}
                >
                  {/* copy to the taste gate */}
                  <Text style={styles.refundBtnText}>refund whole purchase</Text>
                </TouchableOpacity>
                {liveSeats.map((s) => (
                  <TouchableOpacity
                    key={s.positionId}
                    style={[styles.refundBtnSecondary, refunding && styles.refundBtnOff]}
                    onPress={() => confirmRefund([s.positionIndex], `just ticket ${s.referenceCode} --`)}
                    disabled={refunding}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.refundBtnSecondaryText}>refund just {s.referenceCode}</Text>
                  </TouchableOpacity>
                ))}
              </>
            ) : (
              <TouchableOpacity
                style={[styles.refundBtn, refunding && styles.refundBtnOff]}
                onPress={() => confirmRefund(null, 'this purchase --')}
                disabled={refunding}
                activeOpacity={0.85}
              >
                {refunding ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  /* copy to the taste gate */
                  <Text style={styles.refundBtnText}>refund this purchase</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
      <RefundReasonModal
        visible={!!reasonModal}
        amountLabel={reasonModal?.amountLabel ?? ''}
        scopeLabel={reasonModal?.scopeLabel ?? ''}
        submitting={refunding}
        onCancel={() => setReasonModal(null)}
        onSubmit={submitReasonRefund}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  headerTitle: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium },
  body: { padding: 20, paddingBottom: 40, gap: EventSpacing.md },
  card: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 16, gap: 4,
  },
  statusPill: {
    alignSelf: 'flex-start', fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption,
    color: Colors.terracotta, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
  },
  eventTitle: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displaySM, color: Colors.asphalt },
  metaLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  amountLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  amountValue: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  amountValueMuted: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: EventAction.error },
  section: { gap: 8 },
  sectionLabel: {
    fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  seatRow: {
    flexDirection: 'row', gap: 10,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 12,
  },
  seatIcon: { width: 24, alignItems: 'center', paddingTop: 2 },
  seatBody: { flex: 1, gap: 2 },
  seatCode: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, letterSpacing: 1, color: Colors.asphalt },
  seatState: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  answerLine: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.textMedium, marginTop: 4 },
  disclosureCard: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 2, borderLeftColor: EventAction.error,
    padding: 14, gap: 6,
  },
  disclosureLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, lineHeight: 19 },
  refundBtn: {
    backgroundColor: EventAction.error, borderRadius: 999, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 4,
  },
  refundBtnOff: { opacity: 0.5 },
  refundBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  refundBtnSecondary: {
    borderWidth: 1.5, borderColor: EventAction.error, borderRadius: 999, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 8,
  },
  refundBtnSecondaryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: EventAction.error },
});
