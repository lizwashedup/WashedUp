/**
 * C2 - order complete (doc 78 §4, doc 79 C2). A ticket reads as a moment
 * of arrival, not a receipt. Confirms the order, then asks the organizer's
 * buyer questions IN-SESSION with one gentle skip - the elevation
 * commitment (doc 61 §4b). Questions come from proposal 66; answers record
 * to ticket_answers under own-order RLS.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { hapticLight, hapticSuccess } from '../../../lib/haptics';
import { formatEventDateLA } from '../../../lib/laDate';
import {
  getOrder,
  getQuestions,
  recordAnswer,
  type TicketQuestion,
} from '../../../lib/ticketing';

export default function OrderCompleteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const { data: order } = useQuery({
    queryKey: ['ticket-order', id],
    queryFn: () => getOrder(id!),
    enabled: !!id,
  });
  const { data: questions = [] } = useQuery({
    queryKey: ['order-questions', order?.event_id],
    queryFn: () => getQuestions(order!.event_id),
    enabled: !!order?.event_id,
  });

  const submit = useCallback(async () => {
    if (!id || saving) return;
    hapticLight();
    setSaving(true);
    for (const q of questions) {
      const v = answers[q.id]?.trim();
      if (v) await recordAnswer(id, q.id, v);
    }
    setSaving(false);
    setDone(true);
    hapticSuccess();
  }, [id, saving, questions, answers]);

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
        {!!order && (
          <Text style={styles.ref}>ref {order.id.slice(0, 8).toUpperCase()}</Text>
        )}

        {!done && questions.length > 0 && (
          <View style={styles.questions}>
            {/* copy to the taste gate */}
            <Text style={styles.qHeader}>a couple of quick things from the organizer</Text>
            {questions.map((q: TicketQuestion) => (
              <View key={q.id} style={styles.qBlock}>
                <Text style={styles.qPrompt}>
                  {q.prompt}{q.required ? '' : /* copy to the taste gate */ '  (optional)'}
                </Text>
                <TextInput
                  style={styles.qInput}
                  value={answers[q.id] ?? ''}
                  onChangeText={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                  placeholder="your answer"
                  placeholderTextColor={Colors.textLight}
                  multiline={q.qtype === 'paragraph'}
                />
              </View>
            ))}
            <TouchableOpacity style={styles.cta} onPress={submit} disabled={saving} activeOpacity={0.85}>
              {saving ? (
                <ActivityIndicator size="small" color={EventAction.onPrimary} />
              ) : (
                /* copy to the taste gate */
                <Text style={styles.ctaText}>send it</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setDone(true)} hitSlop={8} style={styles.skip}>
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
  questions: { alignSelf: 'stretch', marginTop: EventSpacing.xl, gap: EventSpacing.md },
  qHeader: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  qBlock: { gap: EventSpacing.xs },
  qPrompt: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  qInput: {
    backgroundColor: Colors.inputBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt,
  },
  cta: {
    alignSelf: 'stretch', backgroundColor: EventAction.primary, borderRadius: 999,
    paddingVertical: 15, alignItems: 'center', marginTop: EventSpacing.md,
  },
  ctaText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: EventAction.onPrimary },
  skip: { alignItems: 'center', marginTop: EventSpacing.sm },
  skipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
});
