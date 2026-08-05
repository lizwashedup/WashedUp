/**
 * C2 - order complete (doc 78 §4, doc 79 C2). A ticket reads as a moment of
 * arrival, not a receipt. Then it asks the organizer's buyer questions
 * IN-SESSION with one gentle skip (the elevation commitment, doc 61 §4b).
 *
 * Answers are PER SEAT (Cowork 2026-07-26): a per_attendee question is asked
 * once for every ticket in the order (attendee_index = the seat's
 * position_index, 1..qty); a per_order question is asked once (attendee_index
 * NULL). recordAnswer enforces that and reports failures, which this screen
 * surfaces rather than swallows. Value shapes are the canonical set in
 * lib/ticketing (web's reader reads the same rows). Six types (§3.8).
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { EventAction, EventSpacing } from '../../../constants/EventDesign';
import { hapticLight, hapticSuccess, hapticError } from '../../../lib/haptics';
import { formatEventDateLA } from '../../../lib/laDate';
import {
  getConfirmationMessage,
  getOrder,
  getQuestions,
  recordAnswer,
  type MyOrder,
} from '../../../lib/ticketing';
import {
  QuestionForm,
  cellKey,
  collectCells,
  type AnswerDraft,
  type AnswerRaw,
  type Seat,
} from '../../../components/tickets/QuestionForm';

export default function OrderCompleteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [answers, setAnswers] = useState<AnswerDraft>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // A card charge settles a beat after Stripe returns, and seats only exist
  // once it does. Now that a paid buyer is brought straight here (finding
  // 2), keep asking until the seats show up rather than greeting them with
  // an empty ticket.
  const { data: order } = useQuery({
    queryKey: ['ticket-order', id],
    queryFn: () => getOrder(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const o = query.state.data as MyOrder | null | undefined;
      if (!o) return 4000;
      return o.seats.some((s) => !s.voided) ? false : 4000;
    },
  });
  const settling = !!order && !order.seats.some((s) => !s.voided);
  const { data: questions = [] } = useQuery({
    queryKey: ['order-questions', order?.event_id],
    queryFn: () => getQuestions(order!.event_id),
    enabled: !!order?.event_id,
  });
  // doc 111: the organizer's "after they buy" note; null until SQL-96 lands
  const { data: organizerNote } = useQuery({
    queryKey: ['confirmation-message', order?.event_id],
    queryFn: () => getConfirmationMessage(order!.event_id),
    enabled: !!order?.event_id,
    staleTime: 60_000,
  });

  const qty = order?.qty ?? 1;

  const setCell = useCallback((questionId: string, seat: Seat, patch: AnswerRaw) => {
    const key = cellKey(questionId, seat);
    setAnswers((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  // every (question, seat) pair that carries a real value
  const filledCells = useMemo(
    () => collectCells(questions, answers, qty),
    [questions, answers, qty],
  );

  const submit = useCallback(async () => {
    if (!id || saving) return;
    hapticLight();
    setSaving(true);
    setErrorText(null);
    let failures = 0;
    for (const cell of filledCells) {
      const res = await recordAnswer(id, cell.q.id, cell.value, cell.seat);
      if (!res.ok) failures += 1;
    }
    setSaving(false);
    if (failures > 0) {
      // never swallow the failure: the answers did NOT all save
      hapticError();
      /* copy to the taste gate */
      setErrorText(
        failures === filledCells.length
          ? 'those answers did not send. give it another try.'
          : 'some answers did not send. give it another try.',
      );
      return;
    }
    setDone(true);
    hapticSuccess();
  }, [id, saving, filledCells]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.badge}>
          <Check size={26} color={EventAction.onPrimary} strokeWidth={3} />
        </View>
        {/* copy to the taste gate: arrival, not a receipt */}
        <Text style={styles.title}>you're in</Text>
        {!!order?.event_title && <Text style={styles.eventTitle}>{order.event_title}</Text>}
        {!!order?.event_date && (
          <Text style={styles.eventMeta}>{formatEventDateLA(order.event_date)}</Text>
        )}
        {/* the door checks each seat's reference_code, so those are the only
            codes worth printing; the order id is not a ticket. A paid checkout
            settles within ~a minute, so seats can be briefly empty here; the
            wallet ("see your tickets") is the durable home with the QR. */}
        {settling && (
          /* copy to the taste gate */
          <Text style={styles.settlingNote}>your ticket is being made. it lands here in a moment.</Text>
        )}

        {!!order && order.seats.filter((s) => !s.voided).map((s) => (
          <Text key={s.id} style={styles.ref}>
            {/* copy to the taste gate: per-seat label */}
            {order.qty > 1 ? `ticket ${s.position_index} · ` : ''}{s.reference_code}
          </Text>
        ))}

        {/* doc 111: the organizer speaking, quiet card, the documented
            gold-border quote treatment (no new accents) */}
        {!!organizerNote && (
          <View style={styles.organizerNote}>
            {/* copy to the taste gate */}
            <Text style={styles.organizerNoteLabel}>from the organizer</Text>
            <Text style={styles.organizerNoteText}>{organizerNote}</Text>
          </View>
        )}

        {!done && questions.length > 0 && (
          <View style={styles.questions}>
            {/* copy to the taste gate */}
            <Text style={styles.qHeader}>a couple of quick things from the organizer</Text>
            <QuestionForm
              questions={questions}
              qty={qty}
              draft={answers}
              onCellChange={setCell}
            />

            {!!errorText && <Text style={styles.errorText}>{errorText}</Text>}

            <TouchableOpacity
              style={[styles.cta, (saving || filledCells.length === 0) && styles.ctaOff]}
              onPress={submit}
              disabled={saving || filledCells.length === 0}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              {saving ? (
                <ActivityIndicator size="small" color={EventAction.onPrimary} />
              ) : (
                /* copy to the taste gate */
                <Text style={styles.ctaText}>send it</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setDone(true)} hitSlop={8} style={styles.skip} accessibilityRole="button">
              {/* one gentle skip (doc 61 §4b) */}
              <Text style={styles.skipText}>maybe later</Text>
            </TouchableOpacity>
          </View>
        )}

        {(done || questions.length === 0) && (
          <TouchableOpacity
            style={styles.cta}
            onPress={() => router.replace('/tickets' as never)}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            {/* copy to the taste gate */}
            <Text style={styles.ctaText}>see your tickets</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  content: { padding: 24, alignItems: 'center' },
  badge: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: EventAction.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: EventSpacing.xl, marginBottom: EventSpacing.md,
  },
  title: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayLG, color: Colors.asphalt },
  eventTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt, marginTop: EventSpacing.sm, textAlign: 'center' },
  eventMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, marginTop: 2 },
  ref: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.warmGray, marginTop: EventSpacing.sm, letterSpacing: 1 },
  settlingNote: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, marginTop: EventSpacing.sm, textAlign: 'center' },
  organizerNote: {
    alignSelf: 'stretch', backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 2, borderLeftColor: Colors.goldAccent,
    padding: 14, marginTop: EventSpacing.lg, gap: 4,
  },
  organizerNoteLabel: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  organizerNoteText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.quoteText, lineHeight: 20 },
  questions: { alignSelf: 'stretch', marginTop: EventSpacing.xl, gap: EventSpacing.lg },
  qHeader: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  errorText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: EventAction.error },
  cta: {
    alignSelf: 'stretch', backgroundColor: EventAction.primary, borderRadius: 999,
    paddingVertical: 15, alignItems: 'center', marginTop: EventSpacing.md,
  },
  ctaOff: { opacity: 0.5 },
  ctaText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: EventAction.onPrimary },
  skip: { alignItems: 'center', marginTop: EventSpacing.sm },
  skipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
});
