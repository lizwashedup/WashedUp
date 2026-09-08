import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';
import { clearPendingCheckout, peekPendingCheckout, stashPendingCheckout } from '../lib/pendingLink';
import { getOrder } from '../lib/ticketing';

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Native landing point for the washedup.app Stripe-return bridge. */
export default function CheckoutReturnScreen() {
  const { checkout, order } = useLocalSearchParams<{
    checkout?: string | string[];
    order?: string | string[];
  }>();
  const rawCheckout = Array.isArray(checkout) ? checkout[0] : checkout;
  const rawOrder = Array.isArray(order) ? order[0] : order;
  const directOrderId = rawOrder && ORDER_ID.test(rawOrder) ? rawOrder : null;
  const cancelled = rawCheckout === 'cancelled';
  const [cancelEventId, setCancelEventId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      if (cancelled) {
        await clearPendingCheckout();
        if (directOrderId) {
          try {
            const canceledOrder = await getOrder(directOrderId);
            if (live) setCancelEventId(canceledOrder?.event_id ?? null);
          } catch {
            // The buyer can still return to Scene if the pending row is gone.
          }
        }
        return;
      }
      if (directOrderId) await stashPendingCheckout(directOrderId);
      const orderId = directOrderId ?? await peekPendingCheckout();
      if (!live) return;
      if (orderId) {
        router.replace(`/tickets/order/${orderId}` as never);
      } else {
        router.replace('/tickets' as never);
      }
    })();
    return () => { live = false; };
  }, [cancelled, directOrderId]);

  if (cancelled) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <Text style={styles.cancelTitle}>no worries, nothing was charged.</Text>
          <Text style={styles.cancelBody}>your checkout was cancelled. the tickets are still there if you want them.</Text>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => router.replace(
              (cancelEventId ? `/event/${cancelEventId}` : '/(tabs)/explore') as never,
            )}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={styles.cancelButtonText}>{cancelEventId ? 'back to event' : "what's on"}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <ActivityIndicator color={Colors.terracotta} />
        <Text style={styles.text}>opening your ticket</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.parchment },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  text: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textMedium },
  cancelTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    textAlign: 'center',
  },
  cancelBody: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
  },
  cancelButton: {
    minHeight: 48,
    minWidth: 180,
    borderRadius: 999,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    marginTop: 12,
  },
  cancelButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
