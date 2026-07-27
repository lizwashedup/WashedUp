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
import { hapticLight, hapticSuccess, hapticError } from '../../../lib/haptics';
import { formatEventDateLA } from '../../../lib/laDate';
import {
  getOrder,
  getQuestions,
  recordAnswer,
  type AnswerValue,
  type TicketQuestion,
} from '../../../lib/ticketing';

/** the raw per-(question, seat) draft; converted to an AnswerValue at send. */
interface AnswerRaw {
  text?: string;
  choice?: string;
  choices?: string[];
  accepted?: boolean;
}

/** null seat = a per_order question; a number = a per_attendee seat (1..qty). */
type Seat = number | null;
const cellKey = (questionId: string, seat: Seat): string => `${questionId}:${seat ?? 'order'}`;

/** build the canonical value shape, or null when the seat was left blank. */
function toAnswerValue(q: TicketQuestion, raw: AnswerRaw | undefined): AnswerValue | null {
  if (!raw) return null;
  switch (q.qtype) {
    case 'short_text':
    case 'paragraph': {
      const t = (raw.text ?? '').trim();
      return t ? { text: t } : null;
    }
    case 'single_select':
    case 'dropdown': {
      const c = (raw.choice ?? '').trim();
      return c ? { choice: c } : null;
    }
    case 'multi_select': {
      const cs = (raw.choices ?? []).filter((x) => x.trim().length > 0);
      return cs.length ? { choices: cs } : null;
    }
    case 'terms':
      return raw.accepted ? { accepted: true, accepted_at: new Date().toISOString() } : null;
    default:
      return null;
  }
}

export default function OrderCompleteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [answers, setAnswers] = useState<Record<string, AnswerRaw>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

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

  const qty = order?.qty ?? 1;
  const seatsFor = useCallback(
    (q: TicketQuestion): Seat[] =>
      q.scope === 'per_attendee' ? Array.from({ length: qty }, (_, i) => i + 1) : [null],
    [qty],
  );

  const setCell = (questionId: string, seat: Seat, patch: AnswerRaw) => {
    setAnswers((prev) => ({ ...prev, [cellKey(questionId, seat)]: { ...prev[cellKey(questionId, seat)], ...patch } }));
  };

  // every (question, seat) pair that carries a real value
  const filledCells = useMemo(() => {
    const out: { q: TicketQuestion; seat: Seat; value: AnswerValue }[] = [];
    for (const q of questions) {
      for (const seat of seatsFor(q)) {
        const value = toAnswerValue(q, answers[cellKey(q.id, seat)]);
        if (value) out.push({ q, seat, value });
      }
    }
    return out;
  }, [questions, answers, seatsFor]);

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

  const renderInput = (q: TicketQuestion, seat: Seat) => {
    const key = cellKey(q.id, seat);
    const raw = answers[key] ?? {};
    const opts = q.options ?? [];

    if (q.qtype === 'short_text' || q.qtype === 'paragraph') {
      return (
        <TextInput
          style={[styles.qInput, q.qtype === 'paragraph' && styles.qInputMultiline]}
          value={raw.text ?? ''}
          onChangeText={(v) => setCell(q.id, seat, { text: v })}
          placeholder="your answer"
          placeholderTextColor={Colors.textLight}
          multiline={q.qtype === 'paragraph'}
          accessibilityLabel={q.prompt}
        />
      );
    }

    if (q.qtype === 'single_select' || q.qtype === 'dropdown') {
      return (
        <View style={styles.chipWrap}>
          {opts.map((opt) => {
            const on = raw.choice === opt;
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => { hapticLight(); setCell(q.id, seat, { choice: on ? '' : opt }); }}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={opt}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }

    if (q.qtype === 'multi_select') {
      const chosen = raw.choices ?? [];
      return (
        <View style={styles.chipWrap}>
          {opts.map((opt) => {
            const on = chosen.includes(opt);
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => {
                  hapticLight();
                  setCell(q.id, seat, { choices: on ? chosen.filter((c) => c !== opt) : [...chosen, opt] });
                }}
                activeOpacity={0.85}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={opt}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }

    // terms: the prompt IS the agreement text; a single accept toggle
    const accepted = !!raw.accepted;
    return (
      <TouchableOpacity
        style={styles.termsRow}
        onPress={() => { hapticLight(); setCell(q.id, seat, { accepted: !accepted }); }}
        activeOpacity={0.85}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        accessibilityLabel={`I agree: ${q.prompt}`}
      >
        <View style={[styles.checkbox, accepted && styles.checkboxOn]}>
          {accepted && <Check size={14} color={EventAction.onPrimary} strokeWidth={3} />}
        </View>
        {/* copy to the taste gate */}
        <Text style={styles.termsLabel}>I agree</Text>
      </TouchableOpacity>
    );
  };

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
        {!!order && order.seats.filter((s) => !s.voided).map((s) => (
          <Text key={s.id} style={styles.ref}>
            {/* copy to the taste gate: per-seat label */}
            {order.qty > 1 ? `ticket ${s.position_index} · ` : ''}{s.reference_code}
          </Text>
        ))}

        {!done && questions.length > 0 && (
          <View style={styles.questions}>
            {/* copy to the taste gate */}
            <Text style={styles.qHeader}>a couple of quick things from the organizer</Text>
            {questions.map((q: TicketQuestion) => (
              <View key={q.id} style={styles.qGroup}>
                <Text style={styles.qPrompt}>
                  {q.prompt}
                  {/* copy to the taste gate */}
                  {q.required ? '' : '  (optional)'}
                </Text>
                {seatsFor(q).map((seat) => (
                  <View key={cellKey(q.id, seat)} style={styles.qCell}>
                    {seat !== null && (
                      /* copy to the taste gate: per-seat label for per_attendee */
                      <Text style={styles.seatLabel}>ticket {seat}</Text>
                    )}
                    {renderInput(q, seat)}
                  </View>
                ))}
              </View>
            ))}

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
  questions: { alignSelf: 'stretch', marginTop: EventSpacing.xl, gap: EventSpacing.lg },
  qHeader: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  qGroup: { gap: EventSpacing.sm },
  qPrompt: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  qCell: { gap: EventSpacing.xs },
  seatLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary, letterSpacing: 0.5, textTransform: 'uppercase' },
  qInput: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt,
  },
  qInputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
    paddingHorizontal: 14, paddingVertical: 9, minHeight: 44, justifyContent: 'center',
  },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  chipTextOn: { color: Colors.white },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, minHeight: 44 },
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.white,
  },
  checkboxOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  termsLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
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
