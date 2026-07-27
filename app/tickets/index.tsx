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
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'react-native-qrcode-svg';
import { ArrowLeft, Ticket } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventAction, EventSpacing } from '../../constants/EventDesign';
import { formatEventDateLA } from '../../lib/laDate';
import { formatCents, getMyOrders, type MySeat } from '../../lib/ticketing';

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
              {o.seats.map((seat) => (
                <SeatTicket key={seat.id} seat={seat} qty={o.qty} />
              ))}
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
});
