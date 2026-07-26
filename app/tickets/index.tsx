/**
 * C3 - your tickets (doc 79 C3). The buyer's confirmed orders with
 * reference numbers; a ticket reads as arrival, not a receipt. Animated
 * QR is a later polish, not launch-blocking (doc 78 §4).
 */

import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Ticket } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventAction, EventSpacing } from '../../constants/EventDesign';
import { formatEventDateLA } from '../../lib/laDate';
import { formatCents, getMyOrders } from '../../lib/ticketing';

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
              <View style={styles.cardIcon}>
                <Ticket size={20} color={EventAction.primary} strokeWidth={2} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={1}>{o.event_title ?? 'your event'}</Text>
                {!!o.event_date && (
                  <Text style={styles.cardMeta}>{formatEventDateLA(o.event_date)}</Text>
                )}
                <Text style={styles.cardRef}>
                  {o.qty} {o.qty === 1 ? 'ticket' : 'tickets'} · {o.total_cents === 0 ? 'free' : formatCents(o.total_cents)} · ref {o.id.slice(0, 8).toUpperCase()}
                </Text>
              </View>
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
  content: { padding: 20, gap: EventSpacing.sm },
  loading: { marginTop: EventSpacing.xl },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, marginTop: EventSpacing.xl, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 14,
  },
  cardIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.brandSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  cardMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  cardRef: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.warmGray, marginTop: 2 },
});
