import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Ticket } from 'lucide-react-native';
import Colors from '../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../constants/Typography';
import { peekPendingCheckout, stashPendingDestination } from '../lib/pendingLink';
import { getOrder } from '../lib/ticketing';
import { usePublicPageScope } from '../hooks/usePublicPageScope';

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type ReturnState = { kind: 'loading' | 'error' | 'unavailable' | 'closed' | 'pending'; orderId?: string; eventId?: string };

/** The return link describes the browser visit, never proof of a payment outcome. */
export default function CheckoutReturnScreen() {
  const { checkout, order } = useLocalSearchParams<{ checkout?: string | string[]; order?: string | string[] }>();
  const rawCheckout = Array.isArray(checkout) ? checkout[0] : checkout;
  const rawOrder = Array.isArray(order) ? order[0] : order;
  const directOrderId = rawOrder && ORDER_ID.test(rawOrder) ? rawOrder : null;
  const cancelled = rawCheckout === 'cancelled';
  const { scope, account } = usePublicPageScope(`checkout-return:${rawOrder ?? ''}:${cancelled}`);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ scope: typeof scope; value: ReturnState }>();
  const value: ReturnState = result?.scope === scope ? result.value : { kind: 'loading' };

  useEffect(() => {
    if (!scope?.userId || !scope.isCurrent()) return;
    let active = true;
    const current = () => active && scope.isCurrent();
    const show = (next: ReturnState) => { if (current()) setResult({ scope, value: next }); };
    show({ kind: 'loading' });
    void (async () => {
      // An invalid explicit ID must not open a different, previously saved order.
      if (rawOrder && !directOrderId) { show({ kind: 'unavailable' }); return; }
      const orderId = directOrderId ?? await peekPendingCheckout(true);
      if (!current()) return;
      if (!orderId) { show({ kind: 'closed' }); return; }
      const saved = await getOrder(orderId, { buyerUserId: scope.userId!, strict: true });
      if (!current()) return;
      if (!saved) { show({ kind: 'unavailable' }); return; }
      if (cancelled && saved.status === 'pending') {
        show({ kind: 'pending', orderId: saved.id, eventId: saved.event_id });
        return;
      }
      // The existing order screen owns settlement, tickets, refunds and their recovery.
      // Never clear the durable handoff merely because the URL says cancelled.
      router.replace(`/tickets/order/${saved.id}` as never);
    })().catch(() => show({ kind: 'error' }));
    return () => { active = false; };
  }, [scope, rawOrder, directOrderId, cancelled, attempt]);

  const signedOut = !account.isLoading && !account.error && account.viewerId === null;
  const failed = !!account.error || value.kind === 'error';
  const loading = !signedOut && !failed && (account.isLoading || value.kind === 'loading');
  const heading = signedOut ? 'Sign in to continue' : failed ? 'Let’s check your checkout'
    : value.kind === 'pending' ? 'Checkout is still pending'
    : value.kind === 'unavailable' ? 'Check your tickets' : 'You’re back';
  const body = signedOut ? 'Sign in with the account you used for checkout.'
    : failed ? 'We couldn’t load the latest status. Try again before starting another checkout.'
    : value.kind === 'pending' ? 'Your order hasn’t been confirmed yet. Open it to check the latest status.'
    : value.kind === 'unavailable' ? 'This checkout isn’t available for this account. Your other orders are in Your tickets.'
    : 'Open Your tickets to check your latest orders.';
  const retry = () => { if (account.error) void account.retry().catch(() => undefined); else setAttempt(old => old + 1); };
  const signIn = async () => {
    if (!scope?.isCurrent()) return;
    const destination = directOrderId ? `/checkout-return?order=${directOrderId}${cancelled ? '&checkout=cancelled' : ''}` : '/checkout-return';
    await stashPendingDestination(destination);
    if (scope.isCurrent()) router.replace('/(auth)/phone-entry' as never);
  };
  return <SafeAreaView style={styles.screen}>
    <Stack.Screen options={{ headerShown: false }} />
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to Scene" style={styles.back}
        onPress={() => router.replace('/(tabs)/explore' as never)}><ChevronLeft size={22} color={Colors.asphalt} /></Pressable>
      <Text style={styles.headerLabel}>Checkout</Text>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      {loading ? <View style={styles.loading}>
        <ActivityIndicator color={Colors.terracotta} accessibilityLabel="Checking your order" />
        <Text style={styles.body}>Checking your order…</Text>
      </View> : <View style={styles.panel}>
        <View style={styles.mark}><Ticket size={22} color={Colors.terracotta} /></View>
        <Text accessibilityRole="header" style={styles.title}>{heading}</Text>
        <Text accessibilityRole={failed ? 'alert' : undefined} style={styles.body}>{body}</Text>
        <Pressable accessibilityRole="button" style={styles.primary}
          onPress={signedOut ? () => void signIn() : failed ? retry : () => {
            if (scope?.isCurrent()) router.replace((value.orderId ? `/tickets/order/${value.orderId}` : '/tickets') as never);
          }}><Text numberOfLines={1} style={styles.primaryText}>{signedOut ? 'Sign in' : failed ? 'Try again' : value.orderId ? 'View order' : 'Your tickets'}</Text></Pressable>
        {value.eventId && <Pressable accessibilityRole="button" style={styles.secondary}
          onPress={() => { if (scope?.isCurrent()) router.replace(`/event/${value.eventId}` as never); }}><Text style={styles.secondaryText}>Back to event</Text></Pressable>}
      </View>}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 56 },
  back: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  content: { padding: 20 },
  loading: { paddingVertical: 36, alignItems: 'center', gap: 12 },
  panel: { padding: 20, borderRadius: 20, backgroundColor: Colors.white, gap: 12 },
  mark: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, lineHeight: LineHeights.displayMD, color: Colors.asphalt },
  body: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.textMedium },
  primary: { minHeight: 44, alignSelf: 'flex-start', borderRadius: 22, backgroundColor: Colors.terracotta, paddingHorizontal: 20, paddingVertical: 12, justifyContent: 'center' },
  primaryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  secondary: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  secondaryText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
