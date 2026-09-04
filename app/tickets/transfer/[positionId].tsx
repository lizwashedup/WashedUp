/**
 * Start a ticket transfer (item 15, 2026-09-04). Reached from the "transfer
 * this ticket" link on a live seat in app/tickets/order/[id].tsx. Only the
 * seat's current holder can actually start one -- start_ticket_transfer
 * enforces that server-side, this screen just calls it and shows the result.
 *
 * TICKET_TRANSFER_ENABLED-gated for the same reason as app/t/[code].tsx: the
 * backing migration (20260904010000_ticket_transfer_draft.sql) is not
 * applied anywhere yet.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { EventSpacing } from '../../../constants/EventDesign';
import { TICKET_TRANSFER_ENABLED } from '../../../constants/FeatureFlags';
import { hapticError, hapticLight, hapticSuccess } from '../../../lib/haptics';
import { cancelTransfer, startTransfer } from '../../../lib/ticketTransfer';

type Step = 'starting' | 'ready' | 'canceled' | 'error' | 'off';

export default function StartTicketTransfer() {
  const { positionId } = useLocalSearchParams<{ positionId: string }>();
  const [step, setStep] = useState<Step>('starting');
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!TICKET_TRANSFER_ENABLED) {
        if (!cancelled) setStep('off');
        return;
      }
      if (!positionId || typeof positionId !== 'string') {
        if (!cancelled) setStep('error');
        return;
      }
      const result = await startTransfer(positionId);
      if (cancelled) return;
      if (!result) {
        setStep('error');
        return;
      }
      setCode(result);
      setStep('ready');
    })();
    return () => { cancelled = true; };
  }, [positionId]);

  const share = useCallback(() => {
    if (!code) return;
    hapticLight();
    const link = `https://washedup.app/t/${code}`;
    Share.share({ message: `here's your ticket: ${link}` }).catch(() => {});
  }, [code]);

  const cancel = useCallback(async () => {
    if (!code) return;
    hapticLight();
    const ok = await cancelTransfer(code);
    if (ok) {
      hapticSuccess();
      setStep('canceled');
    } else {
      hapticError();
    }
  }, [code]);

  if (step === 'starting') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.terracotta} />
      </View>
    );
  }

  if (step === 'off' || step === 'error') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          {/* copy to the taste gate */}
          <Text style={styles.title}>can't start a transfer right now</Text>
          <Text style={styles.body}>
            {step === 'off'
              ? 'this isn’t turned on yet.'
              : 'this ticket may not be yours to transfer, or it already has a pending transfer.'}
          </Text>
          <TouchableOpacity style={styles.cta} onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.ctaText}>back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'canceled') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Text style={styles.title}>transfer canceled</Text>
          <Text style={styles.body}>the ticket is still yours.</Text>
          <TouchableOpacity style={styles.cta} onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.ctaText}>back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.centered}>
        <Text style={styles.title}>ready to send</Text>
        <Text style={styles.body}>share this link with whoever's taking the ticket. it works once.</Text>
        <TouchableOpacity style={styles.cta} onPress={share} accessibilityRole="button">
          <Text style={styles.ctaText}>share link</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={cancel} accessibilityRole="button">
          <Text style={styles.secondaryText}>changed your mind? cancel this transfer</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  title: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  body: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center' },
  cta: {
    marginTop: 12, backgroundColor: Colors.terracotta, borderRadius: 999,
    paddingVertical: 14, paddingHorizontal: 28, minHeight: 44, justifyContent: 'center',
  },
  ctaText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  secondary: { marginTop: EventSpacing.md, minHeight: 44, justifyContent: 'center' },
  secondaryText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
});
