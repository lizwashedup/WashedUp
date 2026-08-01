/**
 * C3 - your tickets (doc 79 C3). The buyer's confirmed orders; a ticket reads
 * as arrival, not a receipt. Animated QR is a later polish, not launch-blocking
 * (doc 78 §4).
 *
 * Each SEAT is the ticket: the door checks ticket_order_positions.reference_code
 * (record_ticket_checkin), so that code (never an order-id prefix) is what a
 * seat shows, as a QR the door scanner reads plus the same code in text for the
 * type-a-code path. A voided seat (partial refund) keeps its place in the list
 * but loses its QR, so nobody walks up with a dead code.
 */

import React from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'react-native-qrcode-svg';
import { ArrowLeft, Ticket } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventAction, EventSpacing } from '../../constants/EventDesign';
import { formatEventDateLA } from '../../lib/laDate';
import {
  REFUND_DISCLOSURE, executeRefund, formatCents, getConfirmationMessage,
  getMyOrders, previewRefund,
  type MyOrder, type MySeat,
} from '../../lib/ticketing';

/**
 * doc 111: the organizer's "after they buy" note stays on the tickets, the
 * documented gold-border quote treatment (the organizer speaking, no new
 * accents). Renders nothing until SQL-96's column lands (self-flipping read).
 */
function OrganizerNote({ eventId }: { eventId: string }) {
  const { data: note } = useQuery({
    queryKey: ['confirmation-message', eventId],
    queryFn: () => getConfirmationMessage(eventId),
    staleTime: 60_000,
  });
  if (!note) return null;
  return (
    <View style={styles.organizerNote}>
      {/* copy to the taste gate */}
      <Text style={styles.organizerNoteLabel}>from the organizer</Text>
      <Text style={styles.organizerNoteText}>{note}</Text>
    </View>
  );
}

// the scanner reads from arm's length in door light; smaller and a 10-char
// code still scans, but this size is comfortable on every supported width
const QR_SIZE = 168;
// quiet zone is part of the QR spec: scanners need clear margin around the marks
const QR_QUIET_ZONE = 12;

function SeatTicket({ seat, qty }: { seat: MySeat; qty: number }) {
  if (seat.voided) {
    return (
      <View style={styles.seat}>
        {qty > 1 && (
          /* copy to the taste gate: per-seat label */
          <Text style={styles.seatLabel}>ticket {seat.position_index} of {qty}</Text>
        )}
        <Text style={styles.seatCodeVoided}>{seat.reference_code}</Text>
        {/* copy to the taste gate */}
        <Text style={styles.seatVoidedNote}>this one was refunded and won't scan</Text>
      </View>
    );
  }
  return (
    <View style={styles.seat}>
      {qty > 1 && (
        /* copy to the taste gate: per-seat label */
        <Text style={styles.seatLabel}>ticket {seat.position_index} of {qty}</Text>
      )}
      <View
        style={styles.qrWrap}
        accessible
        accessibilityLabel={`ticket code ${seat.reference_code}`}
      >
        <QRCode
          value={seat.reference_code}
          size={QR_SIZE}
          quietZone={QR_QUIET_ZONE}
          color={Colors.asphalt}
          backgroundColor={Colors.white}
        />
      </View>
      <Text style={styles.seatCode}>{seat.reference_code}</Text>
    </View>
  );
}

/**
 * Buyer self-refund (doc 108; web wallet f370d4b is the lockstep reference).
 * The affordance renders ONLY from the server's preview answer
 * (can_buyer_self_refund is the §5 preset gate); the client never decides
 * eligibility. The refund call itself sends no kind and no seats: the fn
 * forces buyer_request on the whole remaining order and re-checks the gate.
 */
function OrderRefund({ order }: { order: MyOrder }) {
  const queryClient = useQueryClient();
  const { data: preview } = useQuery({
    queryKey: ['ticket-refund-preview', order.id],
    queryFn: () => previewRefund(order.id),
    staleTime: 30_000,
  });

  const refund = useMutation({
    mutationFn: () => executeRefund(order.id),
    onSuccess: (outcome) => {
      if (outcome.ok) {
        queryClient.invalidateQueries({ queryKey: ['my-ticket-orders'] });
        queryClient.invalidateQueries({ queryKey: ['ticket-refund-preview', order.id] });
        /* LIZ COPY (web's shipped strings, mirrored): pending is still success */
        Alert.alert(
          'refund on its way',
          outcome.pending
            ? 'your refund is on its way. it can take a minute to show here.'
            : 'refunded. it lands back on your card in a few days.',
        );
      } else {
        Alert.alert('about that refund', outcome.message);
      }
    },
  });

  if (!preview?.allowed || !preview.canSelfRefund) return null;

  const confirmRefund = () => {
    Alert.alert(
      /* LIZ COPY (web's confirm line, mirrored) */
      `refund ${formatCents(preview.refundAmountCents)} to your card?`,
      REFUND_DISCLOSURE,
      [
        { text: 'keep my tickets', style: 'cancel' },
        { text: 'yes, refund it', style: 'destructive', onPress: () => refund.mutate() },
      ],
    );
  };

  return (
    <View style={styles.refundBlock}>
      {/* §5 disclosure: LIZ COPY RULED verbatim, never reworded */}
      <Text style={styles.refundDisclosure}>{REFUND_DISCLOSURE}</Text>
      <TouchableOpacity
        style={styles.refundButton}
        onPress={confirmRefund}
        disabled={refund.isPending}
        accessibilityRole="button"
        accessibilityLabel="refund this order"
      >
        {refund.isPending ? (
          <ActivityIndicator size="small" color={EventAction.secondaryLabel} />
        ) : (
          /* LIZ COPY (web's trigger label, mirrored) */
          <Text style={styles.refundButtonText}>refund this order</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

export default function YourTicketsScreen() {
  const { data: orders, isLoading } = useQuery({
    queryKey: ['my-ticket-orders'],
    queryFn: getMyOrders,
    staleTime: 15_000,
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle}>your tickets</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {isLoading ? (
          <ActivityIndicator size="small" color={EventAction.primary} style={styles.loading} />
        ) : !orders || orders.length === 0 ? (
          /* copy to the taste gate: the empty-state invitation */
          <Text style={styles.empty}>no tickets yet. when you get one, it lives here.</Text>
        ) : (
          orders.map((o) => (
            <View key={o.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardIcon}>
                  <Ticket size={20} color={EventAction.primary} strokeWidth={2} />
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{o.event_title ?? 'your event'}</Text>
                  {!!o.event_date && (
                    <Text style={styles.cardMeta}>{formatEventDateLA(o.event_date)}</Text>
                  )}
                  <Text style={styles.cardMeta}>
                    {o.qty} {o.qty === 1 ? 'ticket' : 'tickets'} · {o.total_cents === 0 ? 'free' : formatCents(o.total_cents)}
                  </Text>
                </View>
              </View>
              <OrganizerNote eventId={o.event_id} />
              {o.seats.map((seat) => (
                <SeatTicket key={seat.id} seat={seat} qty={o.qty} />
              ))}
              <OrderRefund order={o} />
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  headerTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  headerSpacer: { flex: 1 },
  content: { padding: 20, gap: EventSpacing.md },
  loading: { marginTop: EventSpacing.xl },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, marginTop: EventSpacing.xl, textAlign: 'center' },
  card: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: EventSpacing.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.brandSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  cardMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  seat: {
    alignItems: 'center', gap: EventSpacing.xs,
    borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: EventSpacing.md,
  },
  seatLabel: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  qrWrap: { borderRadius: 12, overflow: 'hidden' },
  seatCode: {
    fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt, letterSpacing: 3,
  },
  seatCodeVoided: {
    fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.textLight,
    letterSpacing: 3, textDecorationLine: 'line-through',
  },
  seatVoidedNote: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  organizerNote: {
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 2, borderLeftColor: Colors.goldAccent,
    padding: 12, gap: 4,
  },
  organizerNoteLabel: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  organizerNoteText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.quoteText, lineHeight: 19 },
  refundBlock: {
    alignItems: 'center', gap: EventSpacing.sm,
    borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: EventSpacing.md,
  },
  refundDisclosure: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium,
    textAlign: 'center', paddingHorizontal: EventSpacing.sm,
  },
  refundButton: {
    minHeight: 44, borderRadius: 999, borderWidth: 1.5, borderColor: EventAction.secondaryBorder,
    paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center',
  },
  refundButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: EventAction.secondaryLabel },
});
