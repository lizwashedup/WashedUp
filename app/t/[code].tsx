/**
 * Ticket-transfer claim landing for https://washedup.app/t/<code> and
 * washedupapp://t/<code> (item 15, 2026-09-04, mirrors app/r/[code].tsx's
 * S-05 shape so a tap from inside the app -- e.g. pasted into a chat --
 * lands here instead of dead-tapping; see lib/url.ts OWN_ROUTE).
 *
 * Unlike a referral claim, this cannot auto-resolve: if the event has
 * required per-attendee questions, the recipient must answer them fresh
 * before the claim RPC will accept it (Liz, item 15 -- the original
 * attendee's answers are never reused). So this screen: loads the transfer
 * preview, fetches those questions, gathers answers if any exist, then
 * claims. TICKET_TRANSFER_ENABLED gates it because the backing migration
 * (20260904010000_ticket_transfer_draft.sql) is not applied anywhere yet --
 * without the flag, calling any of these RPCs against prod would just fail.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';
import { TICKET_TRANSFER_ENABLED } from '../../constants/FeatureFlags';
import { supabase } from '../../lib/supabase';
import { unauthedRoute } from '../../lib/authRouting';
import {
  claimTransfer,
  getRequiredAttendeeQuestions,
  previewTransfer,
  stashPendingTransfer,
} from '../../lib/ticketTransfer';
import {
  QuestionForm,
  buildCheckoutAnswers,
  cellKey,
  missingRequiredPrompts,
  type AnswerDraft,
  type AnswerRaw,
  type Seat,
} from '../../components/tickets/QuestionForm';
import type { TicketQuestion } from '../../lib/ticketing';

type Step = 'loading' | 'questions' | 'claiming' | 'dead' | 'off';

export default function TicketTransferLanding() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const [step, setStep] = useState<Step>('loading');
  const [eventTitle, setEventTitle] = useState('');
  const [eventId, setEventId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<TicketQuestion[]>([]);
  const [draft, setDraft] = useState<AnswerDraft>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!TICKET_TRANSFER_ENABLED) {
        if (!cancelled) setStep('off');
        return;
      }
      if (!code || typeof code !== 'string' || !/^[A-Za-z0-9_-]+$/.test(code)) {
        if (!cancelled) setStep('dead');
        return;
      }
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!data.session?.user) {
          await stashPendingTransfer(code);
          router.replace(unauthedRoute() as never);
          return;
        }
        const preview = await previewTransfer(code);
        if (cancelled) return;
        if (!preview) {
          setStep('dead');
          return;
        }
        setEventTitle(preview.eventTitle);
        setEventId(preview.eventId);
        const qs = await getRequiredAttendeeQuestions(preview.eventId);
        if (cancelled) return;
        if (qs.length === 0) {
          // Nothing to ask -- claim immediately, same as a referral claim.
          const claimed = await claimTransfer(code, []);
          if (cancelled) return;
          if (!claimed) {
            setStep('dead');
            return;
          }
          router.replace('/tickets' as never);
          return;
        }
        setQuestions(qs);
        setStep('questions');
      } catch {
        if (!cancelled) setStep('dead');
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  const onCellChange = useCallback((questionId: string, seat: Seat, patch: AnswerRaw) => {
    const key = cellKey(questionId, seat);
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  }, []);

  const submit = useCallback(async () => {
    if (!code || typeof code !== 'string' || !eventId) return;
    const missing = missingRequiredPrompts(questions, draft, 1);
    if (missing.length > 0) {
      setError(`still need: ${missing.join(', ')}`);
      return;
    }
    setError(null);
    setStep('claiming');
    const answers = buildCheckoutAnswers(questions, draft, 1).map((a) => ({
      question_id: a.question_id,
      value: a.value,
    }));
    const claimedEventId = await claimTransfer(code, answers);
    if (!claimedEventId) {
      setError('that link may have already been used, or something changed. try again from the sender.');
      setStep('questions');
      return;
    }
    router.replace('/tickets' as never);
  }, [code, eventId, questions, draft]);

  if (step === 'loading' || step === 'claiming') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.terracotta} />
      </View>
    );
  }

  if (step === 'off' || step === 'dead') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Text style={styles.title}>this ticket transfer is gone</Text>
          <Text style={styles.body}>the link may be old, already used, or whoever sent it made a new one.</Text>
          <TouchableOpacity
            style={styles.cta}
            onPress={() => router.replace('/(tabs)/plans' as never)}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>see what's on</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>you're claiming a ticket</Text>
        {!!eventTitle && <Text style={styles.body}>{eventTitle}</Text>}
        <Text style={styles.help}>a couple quick answers from you before it's yours.</Text>
        <View style={styles.form}>
          <QuestionForm questions={questions} qty={1} draft={draft} onCellChange={onCellChange} />
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity style={styles.cta} onPress={submit} accessibilityRole="button">
          <Text style={styles.ctaText}>claim ticket</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  scroll: { padding: 24, gap: EventSpacing.md },
  title: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  body: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium },
  help: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, marginBottom: 4 },
  form: { gap: EventSpacing.lg },
  error: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.errorRed },
  cta: {
    marginTop: 12, backgroundColor: Colors.terracotta, borderRadius: 999,
    paddingVertical: 14, paddingHorizontal: 28, minHeight: 44, justifyContent: 'center', alignItems: 'center',
  },
  ctaText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
