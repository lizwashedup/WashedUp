import React, { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { stashPendingCheckout } from '../../lib/pendingLink';
import { resumeTicketCheckout } from '../../lib/resumeTicketCheckout';
import type { CheckoutOwner } from '../../lib/ticketCheckoutAttempt';

export function PendingCheckoutActions({ orderId, owner, onRefresh }: {
  orderId: string; owner: CheckoutOwner; onRefresh: () => Promise<unknown>;
}) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<'resume' | 'check' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (action: 'resume' | 'check') => {
    if (busyRef.current || !owner.userId || !owner.isCurrent()) return;
    busyRef.current = true; setBusy(action); setProblem(null);
    try {
      if (action === 'check') { await onRefresh(); return; }
      const result = await resumeTicketCheckout(orderId, owner);
      if (!owner.isCurrent()) return;
      if (result.kind === 'error') { setProblem(result.message); return; }
      if (result.kind === 'updated') { await onRefresh(); return; }
      await stashPendingCheckout(orderId, true);
      if (!owner.isCurrent()) return;
      await Linking.openURL(result.url);
    } catch {
      if (owner.isCurrent()) setProblem(action === 'check'
        ? 'Your purchase could not be refreshed. Try again.'
        : 'Payment could not be opened. Your original purchase is saved; try again.');
    } finally {
      busyRef.current = false;
      if (owner.isCurrent()) setBusy(null);
    }
  };
  return <View style={styles.wrap}>
    <View style={styles.actions}>
      <Pressable onPress={() => void run('resume')} accessibilityRole="button" accessibilityLabel="Continue payment"
        accessibilityState={{ disabled: !!busy, busy: busy === 'resume' }} disabled={!!busy} style={[styles.primary, busy && styles.busy]}>
        {busy === 'resume' ? <ActivityIndicator color={Colors.white} /> : <Text numberOfLines={1} style={styles.primaryText}>Continue payment</Text>}
      </Pressable>
      <Pressable onPress={() => void run('check')} accessibilityRole="button" accessibilityLabel="Check status"
        accessibilityState={{ disabled: !!busy, busy: busy === 'check' }} disabled={!!busy} style={styles.secondary}>
        {busy === 'check' ? <ActivityIndicator color={Colors.terracotta} /> : <Text numberOfLines={1} style={styles.secondaryText}>Check status</Text>}
      </Pressable>
    </View>
    {!!problem && <Text accessibilityRole="alert" style={styles.problem}>{problem}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: 8, marginTop: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primary: { minHeight: 44, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 24, backgroundColor: Colors.terracotta, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.white },
  secondary: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 11, justifyContent: 'center', alignItems: 'center' },
  secondaryText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  problem: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center', lineHeight: LineHeights.bodyMD },
  busy: { opacity: 0.65 },
});
